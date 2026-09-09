#!/usr/bin/env bash
set -euo pipefail

TUNNEL_NAME="${MULTISCREEN_TUNNEL_NAME:-multiscreen-synced}"
HOSTNAME="${MULTISCREEN_HOSTNAME:-synced.novec.online}"
ORIGIN="${MULTISCREEN_ORIGIN:-http://127.0.0.1:3000}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GENERATED_DIR="$PROJECT_DIR/.cloudflared"
CLOUDFLARED_HOME="${CLOUDFLARED_CONFIG_DIR:-$HOME/.cloudflared}"
CONFIG_FILE="$GENERATED_DIR/synced.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Instaluji cloudflared přes Homebrew…"
    brew install cloudflared
  else
    echo "Chybí cloudflared. Nainstaluj ho a spusť npm run synced:setup znovu." >&2
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Chybí Node.js, který je potřeba i pro tuto aplikaci." >&2
  exit 1
fi

mkdir -p "$CLOUDFLARED_HOME" "$GENERATED_DIR"

if [[ ! -f "$CLOUDFLARED_HOME/cert.pem" ]]; then
  echo "Otevře se přihlášení do Cloudflare. Vyber doménu novec.online."
  cloudflared tunnel login
fi

find_tunnel_id() {
  cloudflared tunnel list --name "$TUNNEL_NAME" --output json \
    | TUNNEL_LOOKUP_NAME="$TUNNEL_NAME" node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const tunnels = JSON.parse(input || "[]");
        if (!tunnels || !Array.isArray(tunnels)) return;
        const exact = tunnels.find((tunnel) => tunnel.name === process.env.TUNNEL_LOOKUP_NAME);
        if (exact?.id) process.stdout.write(exact.id);
      });
    '
}

TUNNEL_ID="$(find_tunnel_id)"
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Vytvářím Cloudflare tunnel ${TUNNEL_NAME}…"
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID="$(find_tunnel_id)"
fi

if [[ -z "$TUNNEL_ID" ]]; then
  echo "Nepodařilo se zjistit ID tunelu $TUNNEL_NAME." >&2
  exit 1
fi

CREDENTIALS_FILE="$CLOUDFLARED_HOME/$TUNNEL_ID.json"
if [[ ! -f "$CREDENTIALS_FILE" ]]; then
  echo "Chybí credentials soubor $CREDENTIALS_FILE." >&2
  exit 1
fi

cat > "$CONFIG_FILE" <<YAML
url: $ORIGIN
tunnel: $TUNNEL_ID
credentials-file: $CREDENTIALS_FILE
YAML

echo "Nastavuji DNS $HOSTNAME pro tunnel ${TUNNEL_ID}…"
if ! ROUTE_OUTPUT="$(cloudflared tunnel route dns "$TUNNEL_ID" "$HOSTNAME" 2>&1)"; then
  if [[ "$ROUTE_OUTPUT" == *"already exists"* || "$ROUTE_OUTPUT" == *"Already exists"* ]]; then
    echo "DNS záznam už existuje. Zkontroluj, že míří na $TUNNEL_ID.cfargotunnel.com."
  else
    echo "$ROUTE_OUTPUT" >&2
    exit 1
  fi
else
  echo "$ROUTE_OUTPUT"
fi

echo "Hotovo. Spusť aplikaci a tunnel příkazem: npm run synced:start"
echo "Veřejná adresa: https://$HOSTNAME"
