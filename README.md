# MultiScreenChaturbate

Next.js app for watching 9 live streams at once, with a left-side preview pane for quick swapping.

## Run locally

```bash
npm install
npm run dev
```

## Workflow

1. Click a channel in the left sidebar to load it into the preview pane.
2. Click any grid tile to swap the preview stream into that slot.
3. Click an occupied tile without a preview selected to send that stream back into preview.

The app stores the grid and preview in local storage.

## Audio-driven gamepad vibration

1. Connect a vibration-capable gamepad and press any button so Chrome can detect it.
2. In an empty slot choose **App/Window Share** and enable audio sharing in Chrome's picker.
3. Use **Test** in the shared slot to verify vibration, then switch **Vibrace** on.
4. Adjust the pink slider to set how strongly the captured audio drives the gamepad motors.

Gamepad vibration support depends on the browser, operating system, connection type, and controller driver. Chrome/Chromium on `localhost` or HTTPS is recommended.

## Saved sessions

Open **Settings → Session** to save the current grid, remote streams, preview and per-slot audio settings locally. Saved sessions can be loaded or deleted later.

For cloud sharing, enter a Pastes.io API key in **Settings → Session** and choose **Uložit na Pastes.io**. The app creates and copies a link in this form:

```text
https://synced.novec.online/?session=PASTES_ID
```

Opening the link automatically downloads and applies the session. The loader also accepts a Pastes.io URL, a bare slug, `?paste=PASTES_ID`, and `/s/PASTES_ID`. The API key is kept only in the current browser tab and is never included in the URL, saved session, or source files.

Browsers do not allow a saved session to silently restore screen/window capture permissions. Display-share slots are restored as placeholders; use **Vyměnit** to select the local window again.

## synced.novec.online Cloudflare Tunnel (macOS)

The included setup creates a dedicated locally-managed tunnel named `multiscreen-synced`, routes `synced.novec.online` to it, and forwards requests to the Next.js app on `127.0.0.1:3000`.

One-time setup:

```bash
npm install
npm run synced:setup
```

Cloudflare opens a browser login if this Mac is not authenticated yet. Select the `novec.online` zone. Then start both the production app and the tunnel with:

```bash
npm run synced:start
```

Keep that terminal and the Mac running while the public address should be available. The generated machine-specific tunnel config is stored under `.cloudflared/` and excluded from Git and the application archive.
