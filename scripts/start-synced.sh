#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/.cloudflared/synced.yml"
APP_URL="http://127.0.0.1:3000"
APP_PID=""

cd "$PROJECT_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Tunnel ještě není nastavený. Nejdřív spusť: npm run synced:setup" >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Chybí cloudflared. Nejdřív spusť: npm run synced:setup" >&2
  exit 1
fi

stop_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID"
    wait "$APP_PID" 2>/dev/null || true
  fi
}
trap stop_app EXIT INT TERM

if curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
  echo "Aplikace už běží na $APP_URL."
else
  if [[ ! -f "$PROJECT_DIR/.next/BUILD_ID" ]]; then
    npm run build
  fi
  npm run start -- --hostname 127.0.0.1 --port 3000 &
  APP_PID=$!

  for _ in {1..30}; do
    if curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
      wait "$APP_PID"
      exit 1
    fi
    sleep 1
  done

  if ! curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
    echo "Aplikace se do 30 sekund nespustila." >&2
    exit 1
  fi
fi

echo "Spouštím https://synced.novec.online — ukončení: Ctrl+C"
cloudflared tunnel --config "$CONFIG_FILE" run
