#!/usr/bin/env python3
"""BlueStacks ADB -> H.264 -> low-latency HLS + control API."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADB_DEFAULT = "/Applications/BlueStacks.app/Contents/MacOS/hd-adb"
FFMPEG_DEFAULT = "/opt/homebrew/bin/ffmpeg"


def find_binary(name: str, extra: list[str] | None = None) -> str:
    candidates = [shutil.which(name)]
    if extra:
        candidates.extend(extra)
    candidates += [f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}"]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise FileNotFoundError(f"Cannot find {name}.")


class Device:
    def __init__(self, adb: str, serial: str):
        self.adb, self.serial = adb, serial

    def base(self) -> list[str]:
        return [self.adb, "-s", self.serial]

    def shell(self, *args: str, timeout: float = 10) -> subprocess.CompletedProcess:
        return subprocess.run(
            self.base() + ["shell", *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )

    def tap(self, x: int, y: int) -> None:
        r = self.shell("input", "tap", str(x), str(y))
        if r.returncode:
            raise RuntimeError(r.stderr.decode(errors="replace"))

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> None:
        r = self.shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration_ms))
        if r.returncode:
            raise RuntimeError(r.stderr.decode(errors="replace"))

    def keyevent(self, key: str) -> None:
        r = self.shell("input", "keyevent", key)
        if r.returncode:
            raise RuntimeError(r.stderr.decode(errors="replace"))


class HLSStreamer:
    def __init__(self, device: Device, ffmpeg: str, hls_dir: Path):
        self.device = device
        self.ffmpeg = ffmpeg
        self.hls_dir = hls_dir
        self.running = True
        self.process: subprocess.Popen | None = None
        self.adb_process: subprocess.Popen | None = None
        self.lock = threading.Lock()
        self.last_error: str | None = None
        self.started_at: float | None = None
        threading.Thread(target=self._supervisor, daemon=True).start()

    def _clear_hls(self) -> None:
        self.hls_dir.mkdir(parents=True, exist_ok=True)
        for p in self.hls_dir.glob("*"):
            try:
                p.unlink()
            except OSError:
                pass

    @staticmethod
    def _has_sps(data: bytes) -> bool:
        # H.264 SPS NAL type is 7. BlueStacks sends Annex-B start codes.
        for marker in (b"\x00\x00\x00\x01", b"\x00\x00\x01"):
            pos = 0
            while True:
                pos = data.find(marker, pos)
                if pos < 0:
                    break
                n = pos + len(marker)
                if n < len(data) and (data[n] & 0x1f) == 7:
                    return True
                pos += 1
        return False

    def _run_once(self) -> None:
        self._clear_hls()

        # Verified on this BlueStacks Air instance: 1080x1920, 25 FPS.
        adb_cmd = self.device.base() + [
            "exec-out", "screenrecord",
            "--output-format=h264",
            "--bit-rate=12000000",
            "--size=1080x1920",
            "--time-limit", "170",
            "-",
        ]
        ffmpeg_cmd = [
            self.ffmpeg,
            "-hide_banner", "-loglevel", "warning",
            "-probesize", "1M",
            "-analyzeduration", "2M",
            "-fflags", "+genpts",
            "-f", "h264",
            "-r", "25",
            "-i", "pipe:0",
            "-an", "-c:v", "copy",
            "-f", "hls",
            "-hls_time", "1",
            "-hls_list_size", "3",
            "-hls_flags", "delete_segments+independent_segments+omit_endlist",
            "-hls_segment_type", "mpegts",
            "-hls_allow_cache", "0",
            str(self.hls_dir / "stream.m3u8"),
        ]

        print("Starting H.264 capture:", " ".join(adb_cmd))
        adb_proc = subprocess.Popen(
            adb_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
        )
        assert adb_proc.stdout is not None

        # Important: pre-read the beginning of the elementary stream before
        # starting FFmpeg. This guarantees SPS/PPS are available immediately
        # and avoids the BlueStacks pipe/probing failure seen previously.
        prebuffer = bytearray()
        deadline = time.time() + 5
        while self.running and time.time() < deadline and len(prebuffer) < 256 * 1024:
            chunk = os.read(adb_proc.stdout.fileno(), 16384)
            if not chunk:
                break
            prebuffer.extend(chunk)
            if self._has_sps(prebuffer):
                break

        if not prebuffer:
            err = b""
            if adb_proc.stderr:
                try:
                    err = adb_proc.stderr.read(4096)
                except Exception:
                    pass
            raise RuntimeError("BlueStacks screenrecord produced no H.264 data: " + err.decode(errors="replace"))

        ff_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        assert ff_proc.stdin is not None

        with self.lock:
            self.process = ff_proc
            self.adb_process = adb_proc
            self.started_at = time.time()
            self.last_error = None

        def ffmpeg_log() -> None:
            if ff_proc.stderr is None:
                return
            for raw in iter(ff_proc.stderr.readline, b""):
                text = raw.decode(errors="replace").strip()
                if text:
                    with self.lock:
                        self.last_error = text
                    print("FFmpeg:", text)

        threading.Thread(target=ffmpeg_log, daemon=True).start()

        def relay() -> None:
            try:
                ff_proc.stdin.write(prebuffer)
                ff_proc.stdin.flush()
                while self.running and adb_proc.poll() is None and ff_proc.poll() is None:
                    chunk = os.read(adb_proc.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    ff_proc.stdin.write(chunk)
                    ff_proc.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
            finally:
                try:
                    ff_proc.stdin.close()
                except Exception:
                    pass

        relay_thread = threading.Thread(target=relay, daemon=True)
        relay_thread.start()

        while self.running and adb_proc.poll() is None and ff_proc.poll() is None:
            time.sleep(0.2)

        for proc in (ff_proc, adb_proc):
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=2)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

        with self.lock:
            self.process = None
            self.adb_process = None

    def _supervisor(self) -> None:
        while self.running:
            try:
                self._run_once()
            except Exception as exc:
                with self.lock:
                    self.last_error = str(exc)
                print("Streamer error:", exc)
            if self.running:
                time.sleep(1)

    def status(self) -> dict:
        with self.lock:
            return {
                "running": self.process is not None and self.process.poll() is None,
                "started_at": self.started_at,
                "playlist_ready": (self.hls_dir / "stream.m3u8").exists(),
                "resolution": "1080x1920",
                "fps": 25,
                "error": self.last_error,
            }

    def stop(self) -> None:
        self.running = False
        with self.lock:
            procs = [self.process, self.adb_process]
        for proc in procs:
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "EmulatorStreamWrapper/0.3"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1024 * 1024:
            raise ValueError("Request body too large")
        return json.loads((self.rfile.read(length) if length else b"{}").decode() or "{}")

    def _serve(self, path: Path, content_type: str) -> None:
        deadline = time.time() + 5
        while not path.exists() and time.time() < deadline:
            time.sleep(0.1)
        if not path.exists():
            self._json(503, {"error": "stream not ready"})
            return
        try:
            data = path.read_bytes()
        except OSError:
            self._json(503, {"error": "stream file temporarily unavailable"})
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/":
            html = b'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emulator Stream Wrapper</title><style>body{background:#111;color:#eee;font-family:system-ui;margin:20px}video{max-width:480px;max-height:800px;background:#000;border:1px solid #444}button{padding:8px 14px;margin:4px}</style></head><body><h1>Emulator Stream Wrapper 0.3</h1><p>BlueStacks / ADB -> H.264 -> HLS</p><video id="v" controls autoplay muted playsinline></video><p><button onclick="post('/api/back')">Back</button><button onclick="post('/api/home')">Home</button></p><pre id="s"></pre><script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script><script>const v=document.getElementById('v'),src='/stream.m3u8';if(v.canPlayType('application/vnd.apple.mpegurl'))v.src=src;else if(window.Hls&&Hls.isSupported()){const h=new Hls({lowLatencyMode:true,maxLiveSyncPlaybackRate:1.5});h.loadSource(src);h.attachMedia(v);h.on(Hls.Events.ERROR,(e,d)=>console.log(d));}async function post(u){await fetch(u,{method:'POST'});}async function status(){try{const r=await fetch('/api/status');document.getElementById('s').textContent=JSON.stringify(await r.json(),null,2)}catch(e){}}setInterval(status,2000);status();</script></body></html>'''
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        if self.path == "/api/status":
            self._json(200, {"ok": True, "device": self.server.device.serial, **self.server.streamer.status()})
            return
        clean = self.path.split("?", 1)[0]
        if clean == "/stream.m3u8":
            return self._serve(self.server.hls_dir / "stream.m3u8", "application/vnd.apple.mpegurl")
        if clean.startswith("/stream_") and clean.endswith(".ts"):
            name = Path(clean).name
            return self._serve(self.server.hls_dir / name, "video/mp2t")
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            data = self._read_json()
            if self.path == "/api/tap":
                self.server.device.tap(int(data["x"]), int(data["y"]))
            elif self.path == "/api/swipe":
                self.server.device.swipe(int(data["x1"]), int(data["y1"]), int(data["x2"]), int(data["y2"]), int(data.get("duration_ms", 300)))
            elif self.path == "/api/back":
                self.server.device.keyevent("KEYCODE_BACK")
            elif self.path == "/api/home":
                self.server.device.keyevent("KEYCODE_HOME")
            else:
                self._json(404, {"error": "not found"})
                return
            self._json(200, {"ok": True})
        except Exception as exc:
            self._json(400, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="auto")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    adb = find_binary("hd-adb", [ADB_DEFAULT]) if os.path.exists(ADB_DEFAULT) else find_binary("adb")
    ffmpeg = find_binary("ffmpeg", [FFMPEG_DEFAULT])

    if args.device == "auto":
        r = subprocess.run([adb, "devices"], capture_output=True, text=True, check=False)
        devices = [x.split("\t", 1)[0] for x in r.stdout.splitlines() if "\tdevice" in x]
        if not devices:
            raise RuntimeError("No ADB device found. Enable ADB in BlueStacks.")
        serial = devices[0]
    else:
        serial = args.device

    device = Device(adb, serial)
    print(f"ADB: {adb}")
    print(f"FFmpeg: {ffmpeg}")
    print(f"Device: {serial}")
    print("Screen: 1080x1920 @ 25 FPS")

    hls_dir = Path(tempfile.mkdtemp(prefix="emulator-hls-"))
    streamer = HLSStreamer(device, ffmpeg, hls_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.device, server.streamer, server.hls_dir = device, streamer, hls_dir

    print(f"Web UI: http://127.0.0.1:{args.port}/")
    print(f"HLS:    http://127.0.0.1:{args.port}/stream.m3u8")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        streamer.stop()
        server.server_close()
        shutil.rmtree(hls_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
