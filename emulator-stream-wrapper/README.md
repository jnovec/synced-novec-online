# Emulator Stream Wrapper

First MVP for wrapping a BlueStacks Android instance with ADB control and a local video stream.

## What it does

- discovers `adb` on macOS
- connects to a selected Android/BlueStacks ADB device
- captures the Android framebuffer with `adb exec-out screencap -p`
- converts the frames with FFmpeg
- exposes a local MJPEG stream
- provides a small HTTP control API for tap, swipe, back, home and screenshot
- keeps the capture/control layer separate so HLS/LL-HLS/WebRTC can be added next

## Quick start

Requirements:

- BlueStacks with ADB enabled
- Android Platform Tools (`adb`)
- FFmpeg
- Python 3.11+

Run:

```bash
cd emulator-stream-wrapper
python3 wrapper.py --device auto --port 8787
```

Then open:

```text
http://127.0.0.1:8787/
```

Stream endpoint:

```text
http://127.0.0.1:8787/stream.mjpeg
```

## ADB control examples

Tap:

```bash
curl -X POST http://127.0.0.1:8787/api/tap \
  -H 'Content-Type: application/json' \
  -d '{"x":500,"y":1200}'
```

Swipe:

```bash
curl -X POST http://127.0.0.1:8787/api/swipe \
  -H 'Content-Type: application/json' \
  -d '{"x1":500,"y1":1200,"x2":500,"y2":500,"duration_ms":300}'
```

Back:

```bash
curl -X POST http://127.0.0.1:8787/api/back
```

Home:

```bash
curl -X POST http://127.0.0.1:8787/api/home
```

## Architecture

```text
BlueStacks
   |
   | ADB framebuffer
   v
wrapper.py
   |
   +--> MJPEG stream
   |
   +--> ADB control API
   |
   v
synced.novec.online / future HLS-LLHLS-WebRTC adapter
```

This is intentionally an MVP. The next step is to replace the PNG-per-frame transport with a persistent H.264 pipeline and add per-instance stream workers.
