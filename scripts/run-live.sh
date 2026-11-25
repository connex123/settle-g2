#!/usr/bin/env bash
# Live run: real Telegram bot + HTTPS via a cloudflared quick tunnel (no account). Token read from the secrets file by the server.
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=${RUN:-$(pwd)/../run}; mkdir -p "$RUN"
CF=${CLOUDFLARED:-cloudflared}
pkill -f "cloudflared tunnel --no-autoupdate" 2>/dev/null || true
pkill -f "node server/src/index.js" 2>/dev/null || true
(nohup "$CF" tunnel --no-autoupdate --protocol http2 --url http://localhost:8787 > "$RUN/tunnel.log" 2>&1 &)
for i in $(seq 1 40); do URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/tunnel.log" | head -1 || true); [ -n "$URL" ] && break; sleep 1; done
echo "$URL" > "$RUN/public-url.txt"
(cd app && VITE_SETTLE_API="$URL" npx vite build --logLevel error)
(PUBLIC_URL="$URL" nohup node server/src/index.js > "$RUN/server.log" 2>&1 &)
sleep 3; echo "public: $URL"; curl -s "$URL/api/health" || true; echo
