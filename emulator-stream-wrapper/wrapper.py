#!/usr/bin/env python3
"""BlueStacks/Android ADB -> low-latency HLS stream + control API.

Uses BlueStacks' bundled ADB and Android screenrecord to produce a persistent
H.264 stream. FFmpeg remuxes/re-encodes it into a short HLS playlist for the
browser. No Python third-party packages are required.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def find_binary(name: str, extra: list[str] | None = None) -> str:
    candidates = [shutil.which(name)]
    if extra:
        candidates.extend(extra)
    candidates.extend([
        "/opt/homebrew/bin/" + name,
        "/usr/local/bin/" + name,
    ])
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise FileNotFoundError(f"Cannot find {name}. Install it and put it on PATH.")


class Device:
    def __init__(self, adb: str, serial: str):
        self.adb = adb
        self.serial = serial

    def base(self) -> list[str]:
        return [self.adb, "-s", self.serial]

    def run(self, *args: str, timeout: float = 10) -> subprocess.CompletedProcess:
        return subprocess.run(
            self.base() + list(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )

    def shell(self, *args: str, timeout: float = 10) -> subprocess.CompletedProcess:
        return self.run("shell", *args, timeout=timeout)

    def tap(self, x: int, y: int) -> None:
        result = self.shell("input", "tap", str(x), str(y))
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace"))

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int) -> None:
        result = self.shell(
            "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration_ms)
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace"))

    def keyevent(self, key: str) -> None:
        result = self.shell("input", "keyevent", key)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace"))

    def screen_size(self) -> tuple[int, int]:
        result = self.shell("wm", "size")
        text = result.stdout.decode(errors="replace")
        for line in text.splitlines():
            if "Physical size:" in line or "Override size:" in line:
                value = line.split(":", 1)[1].strip()
                if "x" in value:
                    w, h = value.split("x", 1)
                    return int(w), int(h)
        return 0, 0


class HLSStreamer:
    def __init__(self, device: Device, ffmpeg: str, hls_dir: Path, fps: int = 30):
        self.device = device
        self.ffmpeg = ffmpeg
        self.hls_dir = hls_dir
        self.fps = max(1, min(fps, 60))
        self.process: subprocess.Popen | None = None
        self.running = True
        self.lock = threading.Lock()
        self.last_error: str | None = None
        self.started_at: float | None = None
        self.thread = threading.Thread(target=self._supervisor, daemon=True)
        self.thread.start()

    def _clear_hls(self) -> None:
        self.hls_dir.mkdir(parents=True, exist_ok=True)
        for p in self.hls_dir.glob("*"):
            try:
                p.unlink()
            except OSError:
                pass

    def _run_once(self) -> None:
        self._clear_hls()

        # screenrecord writes H.264 elementary stream to stdout when '-' is used.
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
            "-fflags", "nobuffer",
            "-f", "h264", "-i", "pipe:0",
            "-an",
            "-c:v", "copy",
            "-f", "hls",
            "-hls_time", "1",
            "-hls_list_size", "4",
            "-hls_flags", "delete_segments+append_list+independent_segments",
            "-hls_segment_type", "mpegts",
            str(self.hls_dir / "stream.m3u8"),
        ]

        print("Starting H.264 capture:", " ".join(adb_cmd))
        adb_proc = subprocess.Popen(
            adb_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        ff_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=adb_proc.stdout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        assert adb_proc.stdout is not None
        adb_proc.stdout.close()

        with self.lock:
            self.process = ff_proc
            self.started_at = time.time()
            self.last_error = None

        def read_ffmpeg_errors() -> None:
            if ff_proc.stderr is None:
                return
            for raw in iter(ff_proc.stderr.readline, b""):
                text = raw.decode(errors="replace").strip()
                if text:
                    with self.lock:
                        self.last_error = text
                    print("FFmpeg:", text)

        threading.Thread(target=read_ffmpeg_errors, daemon=True).start()

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
            process_running = self.process is not None and self.process.poll() is None
            return {
                "running": process_running,
                "started_at": self.started_at,
                "playlist_ready": (self.hls_dir / "stream.m3u8").exists(),
                "error": self.last_error,
            }

    def stop(self) -> None:
        self.running = False
        with self.lock:
            proc = self.process
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass


class Handler(BaseHTTPRequestHandler):
    server_version = "EmulatorStreamWrapper/0.2"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1024 * 1024:
            raise ValueError("Request body too large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode() or "{}")

    def do_GET(self) -> None:
        if self.path == "/":
            html = """<!doctype html>
<html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Emulator Stream Wrapper 0.2</title>
<style>body{background:#111;color:#eee;font-family:system-ui;margin:20px}video{max-width:480px;max-height:800px;background:#000;border:1px solid #444}button{padding:8px 14px;margin:4px}</style>
</head><body><h1>Emulator Stream Wrapper 0.2</h1>
<p>BlueStacks / ADB → H.264 → HLS</p>
<video id=v controls autoplay muted playsinline></video><p>
<button onclick="post('/api/back')">Back</button><button onclick="post('/api/home')">Home</button>
</p><pre id=s></pre>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
const v=document.getElementById('v'); const src='/stream.m3u8';
if(v.canPlayType('application/vnd.apple.mpegurl')) v.src=src;
else if(window.Hls && Hls.isSupported()){const h=new Hls({lowLatencyMode:true,maxLiveSyncPlaybackRate:1.5});h.loadSource(src);h.attachMedia(v);}
async function post(u){await fetch(u,{method:'POST'});}
async function status(){try{const r=await fetch('/api/status');document.getElementById('s').textContent=JSON.stringify(await r.json(),null,2)}catch(e){}}
setInterval(status,2000);status();
</script></body></html>""".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return

        if self.path == "/api/status":
            self._json(200, {"ok": True, "device": self.server.device.serial, **self.server.streamer.status()})
            return

        if self.path.startswith("/stream.m3u8"):
            return self._serve_file(self.server.hls_dir / "stream.m3u8", "application/vnd.apple.mpegurl", 0.2)

        if self.path.endswith(".ts"):
            name = Path(self.path.split("?", 1)[0]).name
            if name.startswith("stream") and name.endswith(".ts"):
                return self._serve_file(self.server.hls_dir / name, "video/mp2t", 0.0)

        self._json(404, {"error": "not found"})

    def _serve_file(self, path: Path, content_type: str, wait: float) -> None:
        deadline = time.time() + 5
        while not path.exists() and time.time() < deadline:
            time.sleep(wait or 0.1)
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

    def do_POST(self) -> None:
        try:
            data = self._read_json()
            if self.path == "/api/tap":
                self.server.device.tap(int(data["x"]), int(data["y"]))
                self._json(200, {"ok": True})
                return
            if self.path == "/api/swipe":
                self.server.device.swipe(int(data["x1"]), int(data["y1"]), int(data["x2"]), int(data["y2"]), int(data.get("duration_ms", 300)))
                self._json(200, {"ok": True})
                return
            if self.path == "/api/back":
                self.server.device.keyevent("KEYCODE_BACK")
                self._json(200, {"ok": True})
                return
            if self.path == "/api/home":
                self.server.device.keyevent("KEYCODE_HOME")
                self._json(200, {"ok": True})
                return
            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._json(400, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main() -> None:
    parser = argparse.ArgumentParser(description="BlueStacks ADB H.264/HLS stream wrapper")
    parser.add_argument("--device", default="auto", help="ADB serial, or auto")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()

    adb = find_binary("hd-adb", ["/Applications/BlueStacks.app/Contents/MacOS/hd-adb"]) if os.path.exists("/Applications/BlueStacks.app/Contents/MacOS/hd-adb") else find_binary("adb")
    ffmpeg = find_binary("ffmpeg", ["/Applications/BlueStacks.app/Contents/MacOS/ffmpeg"])

    if args.device == "auto":
        result = subprocess.run([adb, "devices"], capture_output=True, text=True, check=False)
        devices = [line.split("\t", 1)[0] for line in result.stdout.splitlines() if "\tdevice" in line]
        if not devices:
            raise RuntimeError("No ADB device found. Enable ADB in BlueStacks first.")
        serial = devices[0]
    else:
        serial = args.device

    device = Device(adb, serial)
    width, height = device.screen_size()
    print(f"ADB: {adb}")
    print(f"FFmpeg: {ffmpeg}")
    print(f"Device: {serial}")
    print(f"Screen: {width}x{height}")

    hls_dir = Path(tempfile.mkdtemp(prefix="emulator-hls-"))
    streamer = HLSStreamer(device, ffmpeg, hls_dir, args.fps)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.device = device
    server.streamer = streamer
    server.hls_dir = hls_dir

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
