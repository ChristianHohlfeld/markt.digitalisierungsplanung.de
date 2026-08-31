#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/home/operator/markt.digitalisierungsplanung.de}"
APP_NAME="${APP_NAME:-dp-market}"
cd "$APP_DIR"
npm ci --omit=dev
npm test
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME" --cwd "$APP_DIR" --time
fi
pm2 save
curl -fsS http://127.0.0.1:3010/healthz >/dev/null
