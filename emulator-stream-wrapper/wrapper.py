#!/usr/bin/env python3
"""BlueStacks Air device picker + low-latency HLS streamer + ADB controls."""
from __future__ import annotations

import argparse, json, os, shutil, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADB = "/Applications/BlueStacks.app/Contents/MacOS/hd-adb"
FFMPEG = "/opt/homebrew/bin/ffmpeg"


def binary(name, fallback):
    p = shutil.which(name) or fallback
    if not p or not os.path.isfile(p) or not os.access(p, os.X_OK):
        raise FileNotFoundError(f"Cannot find {name}: {p}")
    return p


def devices(adb):
    r = subprocess.run([adb, "devices", "-l"], capture_output=True, text=True, check=False)
    out = []
    for line in r.stdout.splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[1] != "device":
            continue
        serial = parts[0]
        model = next((x.split(":", 1)[1] for x in parts[2:] if x.startswith("model:")), "unknown")
        product = next((x.split(":", 1)[1] for x in parts[2:] if x.startswith("product:")), "unknown")
        out.append({"serial": serial, "model": model, "product": product, "state": "device"})
    return out


class Device:
    def __init__(self, adb, serial): self.adb, self.serial = adb, serial
    def cmd(self, *args, timeout=10):
        return subprocess.run([self.adb, "-s", self.serial, *args], capture_output=True, timeout=timeout, check=False)
    def shell(self, *args): return self.cmd("shell", *args)
    def tap(self, x, y): self.shell("input", "tap", str(x), str(y))
    def swipe(self, x1, y1, x2, y2, ms=300): self.shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(ms))
    def key(self, k): self.shell("input", "keyevent", k)


class Streamer:
    def __init__(self, adb, ffmpeg, serial, root):
        self.adb, self.ffmpeg, self.serial, self.root = adb, ffmpeg, serial, root
        self.running = True; self.proc = None; self.adbproc = None
        self.lock = threading.Lock(); self.error = None; self.started = None
        threading.Thread(target=self.supervise, daemon=True).start()

    @staticmethod
    def sps(data):
        for marker in (b"\x00\x00\x00\x01", b"\x00\x00\x01"):
            p = 0
            while True:
                p = data.find(marker, p)
                if p < 0: break
                n = p + len(marker)
                if n < len(data) and data[n] & 31 == 7: return True
                p += 1
        return False

    def clear(self):
        self.root.mkdir(parents=True, exist_ok=True)
        for p in self.root.glob("*"):
            try: p.unlink()
            except OSError: pass

    def once(self):
        self.clear()
        adb_cmd = [self.adb, "-s", self.serial, "exec-out", "screenrecord", "--output-format=h264", "--bit-rate=12000000", "--size=1080x1920", "--time-limit", "170", "-"]
        ff = [
            self.ffmpeg, "-hide_banner", "-loglevel", "warning",
            "-probesize", "1M", "-analyzeduration", "2M",
            "-f", "h264", "-r", "25", "-i", "pipe:0",
            "-an", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p", "-r", "25", "-g", "25", "-keyint_min", "25",
            "-sc_threshold", "0", "-b:v", "8M", "-maxrate", "8M", "-bufsize", "8M",
            "-f", "hls", "-hls_time", "1", "-hls_list_size", "2",
            "-hls_flags", "delete_segments+independent_segments+omit_endlist+program_date_time",
            "-hls_segment_type", "mpegts", "-hls_allow_cache", "0",
            str(self.root / "stream.m3u8")
        ]
        print("Starting:", " ".join(adb_cmd))
        a = subprocess.Popen(adb_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        assert a.stdout
        buf = bytearray(); deadline = time.time() + 5
        while self.running and time.time() < deadline and len(buf) < 256*1024:
            c = os.read(a.stdout.fileno(), 16384)
            if not c: break
            buf.extend(c)
            if self.sps(buf): break
        if not buf:
            err = a.stderr.read().decode(errors="replace") if a.stderr else ""
            raise RuntimeError("screenrecord produced no H.264 data" + (f": {err.strip()}" if err.strip() else ""))
        f = subprocess.Popen(ff, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, bufsize=0)
        assert f.stdin
        with self.lock:
            self.proc, self.adbproc, self.started, self.error = f, a, time.time(), None

        def logs():
            if f.stderr:
                for x in iter(f.stderr.readline, b""):
                    if x.strip():
                        msg = x.decode(errors="replace").strip(); print("FFmpeg:", msg)
                        with self.lock: self.error = msg
        threading.Thread(target=logs, daemon=True).start()

        try:
            f.stdin.write(buf); f.stdin.flush()
            while self.running and a.poll() is None and f.poll() is None:
                c = os.read(a.stdout.fileno(), 65536)
                if not c: break
                f.stdin.write(c); f.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            try: f.stdin.close()
            except Exception: pass
        for p in (f, a):
            if p.poll() is None:
                try: p.terminate(); p.wait(timeout=2)
                except Exception:
                    try: p.kill()
                    except Exception: pass
        with self.lock: self.proc = self.adbproc = None

    def supervise(self):
        while self.running:
            try: self.once()
            except Exception as e:
                with self.lock: self.error = str(e)
                print("Streamer:", e)
            if self.running: time.sleep(1)

    def status(self):
        with self.lock:
            return {"running": bool(self.proc and self.proc.poll() is None), "device": self.serial,
                    "playlist_ready": (self.root/"stream.m3u8").exists(), "resolution": "1080x1920",
                    "fps": 25, "live_only": True, "error": self.error}

    def stop(self):
        self.running = False
        for p in (self.proc, self.adbproc):
            if p and p.poll() is None:
                try: p.terminate()
                except Exception: pass


class Handler(BaseHTTPRequestHandler):
    server_version = "EmulatorStreamWrapper/0.7"

    def json(self, code, obj):
        b=json.dumps(obj, ensure_ascii=False).encode(); self.send_response(code); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Cache-Control","no-store"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)

    def body(self):
        n=int(self.headers.get("Content-Length","0")); return json.loads((self.rfile.read(n) if n else b"{}").decode() or "{}")

    def file(self, p, ct):
        end=time.time()+5
        while not p.exists() and time.time()<end: time.sleep(.1)
        if not p.exists(): return self.json(503,{"error":"stream not ready"})
        try: b=p.read_bytes()
        except OSError: return self.json(503,{"error":"file temporarily unavailable"})
        self.send_response(200); self.send_header("Content-Type",ct); self.send_header("Cache-Control","no-cache, no-store, must-revalidate"); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path=="/api/devices": return self.json(200,{"ok":True,"devices":devices(self.server.adb)})
        if self.path=="/api/status": return self.json(200,{"ok":True,**self.server.stream.status()})
        if self.path=="/api/events":
            try: after=int(self.path.split("?after=",1)[1]) if "?after=" in self.path else 0
            except ValueError: after=0
            with self.server.events_lock:
                ev=[x for x in self.server.events if x["id"]>after]
            return self.json(200,{"ok":True,"events":ev})
        clean=self.path.split("?",1)[0]
        if clean=="/stream.m3u8": return self.file(self.server.stream.root/"stream.m3u8","application/vnd.apple.mpegurl")
        if clean.startswith("/stream") and clean.endswith(".ts"):
            name=Path(clean).name
            if name.startswith("stream"): return self.file(self.server.stream.root/name,"video/mp2t")
        if clean=="/":
            html=PAGE.encode(); self.send_response(200); self.send_header("Content-Type","text/html; charset=utf-8"); self.send_header("Cache-Control","no-store"); self.send_header("Content-Length",str(len(html))); self.end_headers(); self.wfile.write(html); return
        return self.json(404,{"error":"not found"})

    def add_event(self, kind, data):
        with self.server.events_lock:
            self.server.event_id += 1
            ev={"id":self.server.event_id,"ts":time.time(),"kind":kind,**data}
            self.server.events.append(ev)
            self.server.events=self.server.events[-100:]

    def do_POST(self):
        try:
            d=self.body()
            if self.path=="/api/select":
                serial=str(d["serial"])
                if serial not in [x["serial"] for x in devices(self.server.adb)]: return self.json(400,{"error":"device not available"})
                old=self.server.stream; old.stop(); time.sleep(.2)
                self.server.stream=Streamer(self.server.adb,self.server.ffmpeg,serial,self.server.root)
                self.add_event("select", {"serial":serial})
                return self.json(200,{"ok":True,"device":serial})
            if self.path=="/api/stop": self.server.stream.stop(); return self.json(200,{"ok":True})
            dev=Device(self.server.adb,self.server.stream.serial)
            if self.path=="/api/tap":
                x,y=int(d["x"]),int(d["y"]); dev.tap(x,y); self.add_event("tap",{"x":x,"y":y})
            elif self.path=="/api/swipe":
                x1,y1,x2,y2=int(d["x1"]),int(d["y1"]),int(d["x2"]),int(d["y2"]); ms=int(d.get("duration_ms",300)); dev.swipe(x1,y1,x2,y2,ms); self.add_event("swipe",{"x1":x1,"y1":y1,"x2":x2,"y2":y2,"duration_ms":ms})
            elif self.path=="/api/back": dev.key("KEYCODE_BACK"); self.add_event("key",{"key":"BACK"})
            elif self.path=="/api/home": dev.key("KEYCODE_HOME"); self.add_event("key",{"key":"HOME"})
            else: return self.json(404,{"error":"not found"})
            self.json(200,{"ok":True})
        except Exception as e: self.json(400,{"ok":False,"error":str(e)})

    def log_message(self,fmt,*args): print("[%s] %s"%(self.log_date_time_string(),fmt%args))


PAGE='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synced Emulator Manager</title><style>
body{margin:0;background:#101114;color:#eee;font-family:system-ui;padding:24px}h1{margin-top:0}.top{display:flex;gap:10px;align-items:center;margin-bottom:20px}button{border:0;border-radius:8px;padding:9px 14px;cursor:pointer}.player{position:relative;width:min(420px,100%);background:#000;border-radius:10px;overflow:hidden}.player video{display:block;width:100%;max-height:78vh;object-fit:contain;background:#000}.overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden}.control{position:absolute;opacity:0;transform:scale(.65);transition:opacity .12s ease,transform .12s ease;animation:controlFade 900ms ease forwards}.control.tap{width:54px;height:54px;border:3px solid rgba(255,255,255,.95);border-radius:50%;box-shadow:0 0 0 10px rgba(255,255,255,.16),0 0 22px rgba(255,255,255,.65);background:rgba(255,255,255,.12);margin:-27px 0 0 -27px}.control.swipe{height:6px;background:rgba(255,255,255,.9);border-radius:6px;transform-origin:left center;box-shadow:0 0 14px rgba(255,255,255,.75)}.control.swipe:after{content:"";position:absolute;right:-3px;top:-8px;border-left:18px solid rgba(255,255,255,.95);border-top:11px solid transparent;border-bottom:11px solid transparent}.control.key{padding:8px 13px;border-radius:10px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.65);backdrop-filter:blur(4px);font-weight:700;letter-spacing:.08em;margin:-20px 0 0 -50px}.control.key:after{content:""}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{background:#1b1d22;border:1px solid #30333a;border-radius:12px;padding:16px}.serial{font-weight:700}.muted{color:#9da3ad;font-size:13px}.selected{border-color:#6ee7b7}.row{display:flex;justify-content:space-between;align-items:center}@keyframes controlFade{0%{opacity:0;transform:scale(.65)}12%{opacity:1;transform:scale(1)}55%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.96)}}
</style></head><body><h1>Synced Emulator Manager</h1><div class="top"><button onclick="load()">↻ Obnovit seznam</button><span id="state" class="muted"></span></div><div id="list" class="grid"></div><h2>Stream</h2><div class="player"><video id="v" autoplay muted playsinline disablepictureinpicture></video><div id="overlay" class="overlay"></div></div><pre id="status"></pre><script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script><script>
let h=null, videoStarted=false, statusBusy=false, lastEvent=0;
async function load(){try{let r=await fetch('/api/devices',{cache:'no-store'});let x=await r.json();let s=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());document.getElementById('state').textContent='Aktivní: '+s.device;document.getElementById('list').innerHTML=x.devices.map(d=>`<div class="card ${d.serial===s.device?'selected':''}"><div class="row"><span class="serial">${d.serial}</span><span>● READY</span></div><p class="muted">model: ${d.model}<br>product: ${d.product}</p><button onclick="selectDevice('${d.serial}')">${d.serial===s.device?'AKTIVNÍ':'STREAMOVAT'}</button></div>`).join('')||'<div class="card">Žádný dostupný BlueStacks emulator.</div>';updateStatus(s);if(s.playlist_ready&&!videoStarted)startVideo()}catch(e){document.getElementById('state').textContent='Chyba: '+e}}
async function selectDevice(serial){document.getElementById('state').textContent='Spouštím '+serial+'…';await fetch('/api/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serial})});videoStarted=false;startVideo(true);setTimeout(load,800)}
function startVideo(force=false){if(videoStarted&&!force)return;videoStarted=true;const v=document.getElementById('v');if(h){h.destroy();h=null}v.pause();v.removeAttribute('src');v.load();const src='/stream.m3u8?v='+Date.now();if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=src;v.play().catch(()=>{});attachLiveGuard()}else if(window.Hls&&Hls.isSupported()){h=new Hls({lowLatencyMode:true,backBufferLength:0,maxBufferLength:2,maxMaxBufferLength:3,liveSyncDurationCount:1,liveMaxLatencyDurationCount:2,maxLiveSyncPlaybackRate:1.2});h.on(Hls.Events.MANIFEST_PARSED,()=>{v.play().catch(()=>{});snapLive()});h.on(Hls.Events.ERROR,(e,data)=>{if(data.fatal){h.destroy();h=null;videoStarted=false;setTimeout(()=>startVideo(true),500)}});h.loadSource(src);h.attachMedia(v);attachLiveGuard()}}
function snapLive(){const v=document.getElementById('v');if(Number.isFinite(v.duration)&&v.duration>0){try{v.currentTime=Math.max(0,v.duration-.05)}catch(e){}}}
function attachLiveGuard(){const v=document.getElementById('v');v.onseeking=()=>{if(Number.isFinite(v.duration)&&v.duration>0&&v.currentTime<v.duration-.8)snapLive()};v.onloadedmetadata=()=>snapLive();v.onplay=()=>snapLive()}
function updateStatus(s){document.getElementById('status').textContent=JSON.stringify(s,null,2)}
async function status(){if(statusBusy)return;statusBusy=true;try{let s=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());updateStatus(s);if(s.playlist_ready&&!videoStarted)startVideo();pollEvents()}finally{statusBusy=false}}
async function pollEvents(){try{let r=await fetch('/api/events?after='+lastEvent,{cache:'no-store'});let x=await r.json();for(const ev of x.events){lastEvent=Math.max(lastEvent,ev.id);showControl(ev)}}catch(e){}}
function showControl(ev){const ov=document.getElementById('overlay'), el=document.createElement('div');el.className='control '+ev.kind;const v=document.getElementById('v');if(ev.kind==='tap'){el.style.left=(ev.x/1080*100)+'%';el.style.top=(ev.y/1920*100)+'%'}else if(ev.kind==='swipe'){const x1=ev.x1/1080*100,y1=ev.y1/1920*100,x2=ev.x2/1080*100,y2=ev.y2/1920*100;const dx=x2-x1,dy=y2-y1;const px=Math.hypot((dx/100)*v.clientWidth,(dy/100)*v.clientHeight);el.style.left=x1+'%';el.style.top=y1+'%';el.style.width=px+'px';el.style.transform='rotate('+Math.atan2((dy/100)*v.clientHeight,(dx/100)*v.clientWidth)*180/Math.PI+'deg)'}else{el.className='control key';el.textContent=ev.key;el.style.left='50%';el.style.top='50%'}ov.appendChild(el);setTimeout(()=>el.remove(),950)}
load();setInterval(status,500);
</script></body></html>'''


def main():
    p=argparse.ArgumentParser(); p.add_argument("--port",type=int,default=8787); p.add_argument("--device",default="auto"); a=p.parse_args()
    adb=binary("hd-adb",ADB); ff=binary("ffmpeg",FFMPEG)
    ds=devices(adb)
    if not ds: raise RuntimeError("No ADB devices found. Enable ADB in BlueStacks.")
    serial=a.device if a.device!="auto" else ds[0]["serial"]
    if serial not in [x["serial"] for x in ds]: raise RuntimeError(f"Device not found: {serial}")
    root=Path(tempfile.mkdtemp(prefix="emulator-hls-")); stream=Streamer(adb,ff,serial,root)
    srv=ThreadingHTTPServer(("127.0.0.1",a.port),Handler); srv.adb=adb; srv.ffmpeg=ff; srv.stream=stream; srv.root=root
    srv.events=[]; srv.event_id=0; srv.events_lock=threading.Lock()
    print("ADB:",adb); print("FFmpeg:",ff); print("Devices:",len(ds)); print("Selected:",serial); print(f"Web UI: http://127.0.0.1:{a.port}/")
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    finally: stream.stop(); srv.server_close(); shutil.rmtree(root,ignore_errors=True)

if __name__=="__main__": main()
