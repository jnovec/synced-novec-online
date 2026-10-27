#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/.cloudflared/synced.yml"
RUNTIME_CONFIG="$PROJECT_DIR/.cloudflared/synced-runtime-$$.yml"
APP_PID=""
TUNNEL_PID=""
STARTUP_TIMEOUT_SECONDS="${MULTISCREEN_STARTUP_TIMEOUT_SECONDS:-240}"
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
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    kill "$TUNNEL_PID"
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID"
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$RUNTIME_CONFIG"
}
trap stop_app EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -f "$PROJECT_DIR/.next/BUILD_ID" ]]; then
  npm run build
fi

"$PROJECT_DIR/node_modules/.bin/next" start --hostname 127.0.0.1 --port "$APP_PORT" &
APP_PID=$!

if [[ ! "$STARTUP_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( STARTUP_TIMEOUT_SECONDS < 30 || STARTUP_TIMEOUT_SECONDS > 600 )); then
  echo "Invalid MULTISCREEN_STARTUP_TIMEOUT_SECONDS (expected 30–600 seconds)." >&2
  exit 1
fi

echo "Waiting up to ${STARTUP_TIMEOUT_SECONDS}s for Next.js on ${APP_URL}"
for (( attempt = 1; attempt <= STARTUP_TIMEOUT_SECONDS; attempt += 1 )); do
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
cloudflared tunnel --config "$RUNTIME_CONFIG" run &
TUNNEL_PID=$!
wait "$TUNNEL_PID"
