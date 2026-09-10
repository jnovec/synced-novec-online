#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/.cloudflared/synced.yml"
RUNTIME_CONFIG="$PROJECT_DIR/.cloudflared/synced-runtime-$$.yml"
APP_PID=""
PORT_START="${MULTISCREEN_PORT_START:-3000}"
PORT_MAX="${MULTISCREEN_PORT_MAX:-3099}"

cd "$PROJECT_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Tunnel ještě není nastavený. Nejdřív spusť: npm run synced:setup" >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Chybí cloudflared. Nejdřív spusť: npm run synced:setup" >&2
  exit 1
fi

if ! command -v nc >/dev/null 2>&1; then
  echo "Chybí příkaz nc pro kontrolu volného portu." >&2
  exit 1
fi

port_is_busy() {
  nc -z 127.0.0.1 "$1" >/dev/null 2>&1
}

find_free_port() {
  local port="$PORT_START"
  while [[ "$port" -le "$PORT_MAX" ]]; do
    if ! port_is_busy "$port"; then
      printf '%s' "$port"
      return 0
    fi
    port=$((port + 1))
  done
  return 1
}

APP_PORT="$(find_free_port || true)"
if [[ -z "$APP_PORT" ]]; then
  echo "Nenašel jsem volný port v rozsahu ${PORT_START}-${PORT_MAX}." >&2
  exit 1
fi

APP_URL="http://127.0.0.1:${APP_PORT}"

if [[ "$APP_PORT" != "$PORT_START" ]]; then
  echo "Port ${PORT_START} je obsazený. Použiju port ${APP_PORT}."
else
  echo "Používám port ${APP_PORT}."
fi

# Vytvoř konfiguraci tunelu jen pro tento běh a přesměruj ji na vybraný port.
awk -v app_url="$APP_URL" '
  BEGIN { replaced = 0 }
  /^url:[[:space:]]*/ && !replaced {
    print "url: " app_url
    replaced = 1
    next
  }
  { print }
  END {
    if (!replaced) print "url: " app_url
  }
' "$CONFIG_FILE" > "$RUNTIME_CONFIG"

stop_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID"
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$RUNTIME_CONFIG"
}
trap stop_app EXIT INT TERM

if [[ ! -f "$PROJECT_DIR/.next/BUILD_ID" ]]; then
  npm run build
fi

npm run start -- --hostname 127.0.0.1 --port "$APP_PORT" &
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
  echo "Aplikace se na portu ${APP_PORT} nespustila." >&2
  exit 1
fi

echo "Synced běží lokálně na $APP_URL"
echo "Spouštím https://synced.novec.online — ukončení: Ctrl+C"
cloudflared tunnel --config "$RUNTIME_CONFIG" run
