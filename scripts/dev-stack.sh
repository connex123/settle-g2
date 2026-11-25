#!/usr/bin/env bash
# Local dev/test stack: fake Telegram (:8081) + Settle server (:8787) + simulator (:9898). Fresh state each run.
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f "scripts/fake-telegram.mjs" 2>/dev/null || true
pkill -f "node server/src/index.js" 2>/dev/null || true
rm -rf /tmp/settle-test
(node scripts/fake-telegram.mjs > /tmp/faketg.log 2>&1 &)
sleep 1
(TELEGRAM_API_BASE=http://localhost:8081 TELEGRAM_BOT_TOKEN=fake:token SETTLE_DATA_DIR=/tmp/settle-test node server/src/index.js > /tmp/settle.log 2>&1 &)
sleep 2
./scripts/sim-headless.sh
