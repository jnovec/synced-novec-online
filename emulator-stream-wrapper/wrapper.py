#!/usr/bin/env python3
"""BlueStacks/Android ADB -> MJPEG stream + control API MVP.

No third-party Python packages are required.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

BOUNDARY = b"frame"


def find_binary(name: str) -> str:
    candidates = [
        shutil.which(name),
        "/opt/homebrew/bin/" + name,
        "/usr/local/bin/" + name,
        os.path.expanduser("~/Library/Android/sdk/platform-tools/" + name),
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise FileNotFoundError(f"Cannot find {name}. Install it and put it on PATH.")


class Device:
    def __init__(self, adb: str, serial: str | None):
        self.adb = adb
        self.serial = serial

    def base(self) -> list[str]:
        cmd = [self.adb]
        if self.serial and self.serial != "auto":
            cmd += ["-s", self.serial]
        return cmd

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

    def resolve(self) -> str:
        result = subprocess.run(
            [self.adb, "devices"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        devices = []
        for line in result.stdout.splitlines():
            if "\tdevice" in line:
                devices.append(line.split("\t", 1)[0])
        if not devices:
            raise RuntimeError("No ADB device found. Enable ADB in BlueStacks first.")
        if self.serial and self.serial != "auto":
            if self.serial not in devices:
                raise RuntimeError(f"ADB device {self.serial!r} is not connected.")
            return self.serial
        return devices[0]

    def screencap(self) -> bytes:
        result = self.run("exec-out", "screencap", "-p", timeout=5)
        if result.returncode != 0 or not result.stdout:
            raise RuntimeError(result.stderr.decode(errors="replace") or "screencap failed")
        return result.stdout

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


class FrameStore:
    def __init__(self, device: Device, fps: float):
        self.device = device
        self.fps = max(1.0, min(fps, 30.0))
        self.lock = threading.Lock()
        self.frame = None
        self.last_error = None
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        interval = 1.0 / self.fps
        while self.running:
            started = time.monotonic()
            try:
                frame = self.device.screencap()
                with self.lock:
                    self.frame = frame
                    self.last_error = None
            except Exception as exc:
                with self.lock:
                    self.last_error = str(exc)
            elapsed = time.monotonic() - started
            time.sleep(max(0.0, interval - elapsed))

    def get(self):
        with self.lock:
            return self.frame, self.last_error

    def stop(self) -> None:
        self.running = False


class Handler(BaseHTTPRequestHandler):
    server_version = "EmulatorStreamWrapper/0.1"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
<html><head><meta charset=utf-8><title>Emulator Stream Wrapper</title>
<style>body{background:#111;color:#eee;font-family:system-ui;margin:20px}img{max-width:480px;max-height:800px;border:1px solid #444}button{padding:8px;margin:4px}</style>
</head><body><h1>Emulator Stream Wrapper 0.1</h1>
<p>BlueStacks / Android ADB → MJPEG</p><img src="/stream.mjpeg"><p>
<button onclick="post('/api/back')">Back</button><button onclick="post('/api/home')">Home</button>
</p><script>async function post(u){await fetch(u,{method:'POST'})}</script></body></html>""".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return

        if self.path == "/api/status":
            frame, error = self.server.frames.get()
            self._json(200, {
                "ok": error is None,
                "device": self.server.device.serial,
                "frame_ready": frame is not None,
                "error": error,
            })
            return

        if self.path == "/api/screenshot":
            frame, error = self.server.frames.get()
            if not frame:
                self._json(503, {"error": error or "No frame yet"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(frame)))
            self.end_headers()
            self.wfile.write(frame)
            return

        if self.path == "/stream.mjpeg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while True:
                    frame, _ = self.server.frames.get()
                    if frame:
                        self.wfile.write(b"--" + BOUNDARY + b"\r\n")
                        self.wfile.write(b"Content-Type: image/png\r\n")
                        self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                        self.wfile.write(frame)
                        self.wfile.write(b"\r\n")
                        self.wfile.flush()
                    time.sleep(1.0 / self.server.frames.fps)
            except (BrokenPipeError, ConnectionResetError):
                return
            return

        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            data = self._read_json()
            if self.path == "/api/tap":
                self.server.device.tap(int(data["x"]), int(data["y"]))
                self._json(200, {"ok": True})
                return
            if self.path == "/api/swipe":
                self.server.device.swipe(
                    int(data["x1"]), int(data["y1"]), int(data["x2"]), int(data["y2"]),
                    int(data.get("duration_ms", 300)),
                )
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
    parser = argparse.ArgumentParser(description="BlueStacks ADB stream wrapper MVP")
    parser.add_argument("--device", default="auto", help="ADB serial, or auto")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--fps", type=float, default=8.0)
    args = parser.parse_args()

    adb = find_binary("adb")
    device = Device(adb, args.device)
    device.serial = device.resolve()

    frames = FrameStore(device, args.fps)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.device = device
    server.frames = frames

    print(f"ADB: {adb}")
    print(f"Device: {device.serial}")
    print(f"Web UI: http://127.0.0.1:{args.port}/")
    print(f"MJPEG: http://127.0.0.1:{args.port}/stream.mjpeg")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        frames.stop()
        server.server_close()


if __name__ == "__main__":
    main()
