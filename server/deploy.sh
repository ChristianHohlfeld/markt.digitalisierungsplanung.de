#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/home/operator/markt.digitalisierungsplanung.de}"
SERVICE="${SERVICE:-dp-market.service}"
cd "$APP_DIR"
npm ci --omit=dev
npm test
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE"
sudo systemctl restart "$SERVICE"
curl -fsS http://127.0.0.1:3010/healthz >/dev/null
