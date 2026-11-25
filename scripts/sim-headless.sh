#!/usr/bin/env bash
# Run the Settle G2 app in the Even Hub simulator on a virtual display (Linux, headless).
# vite dev server :5173, simulator automation API :9898 (screenshots + scripted input).
set -euo pipefail
cd "$(dirname "$0")/../app"
SIM=./node_modules/.bin/evenhub-simulator
pgrep -f "vite --port 5173" >/dev/null || (npx vite --port 5173 --host 127.0.0.1 >/tmp/vite.log 2>&1 &)
pgrep -f "Xvfb :99" >/dev/null || (Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &)
sleep 3
pkill -f "sim-linux-x64/bin/evenhub-simulator" 2>/dev/null || true
(DISPLAY=:99 RUST_LOG=info "$SIM" http://127.0.0.1:5173 --automation-port 9898 ${SIM_ARGS:-} >/tmp/sim.log 2>&1 &)
for i in $(seq 1 30); do curl -s http://127.0.0.1:9898/api/ping >/dev/null 2>&1 && break; sleep 1; done
curl -s http://127.0.0.1:9898/api/ping; echo
# screenshot:  curl -s http://127.0.0.1:9898/api/screenshot/glasses -o shot.png
# input:       curl -s -X POST http://127.0.0.1:9898/api/input -H 'Content-Type: application/json' -d '{"action":"click"}'
