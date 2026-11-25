#!/usr/bin/env bash
# Records the demo: simulator glasses window + group chat window, composed to 1920x1080 with captions.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-/home/box/bounty/dorahacks/even-realities/video}; mkdir -p "$OUT"
CHAT_URL=${CHAT_URL:-http://localhost:8081/}
export DISPLAY=:99
SIM_ARGS="--aid alsa:pulse" ./scripts/dev-stack.sh >/dev/null
sleep 5
pkill -f "user-data-dir=/tmp/demo-chrome" 2>/dev/null || true
(google-chrome --user-data-dir=/tmp/demo-chrome --no-first-run --no-default-browser-check --disable-gpu --app="$CHAT_URL" --window-position=0,0 --window-size=474,592 --force-device-scale-factor=1.35 >/tmp/chrome.log 2>&1 &)
sleep 5
B=$(xdotool search --name "^Browser$" | head -1); [ -n "$B" ] && xdotool windowmove "$B" 1400 0 || true
G=$(xdotool search --name "Glasses Display" | head -1); xdotool windowmove "$G" 660 0; xdotool windowraise "$G"
sleep 1
T0=$(($(date +%s%3N)))
ffmpeg -y -loglevel error -f x11grab -framerate 30 -video_size 1280x800 -i :99 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$OUT/raw.mp4" &
FF=$!
sleep 0.5
PAYEE_ADDR=${PAYEE_ADDR:?set PAYEE_ADDR} T0=$T0 CAPTIONS="$OUT/captions.json" node scripts/demo-driver.mjs
kill -INT $FF; wait $FF || true
python3 scripts/compose-demo.py "$OUT/raw.mp4" "$OUT/captions.json" "$OUT/settle-demo.mp4"
ls -la "$OUT"
