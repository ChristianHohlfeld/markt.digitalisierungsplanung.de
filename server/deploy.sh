#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/home/operator/markt.digitalisierungsplanung.de}"
APP_NAME="${APP_NAME:-dp-market}"
DEFAULT_REGISTRY_PATH="/home/operator/.local/share/dp-market/registry.json"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "missing $APP_DIR/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source ./.env
set +a

REGISTRY_PATH="${REGISTRY_PATH:-$DEFAULT_REGISTRY_PATH}"
if [[ "$REGISTRY_PATH" != /* ]]; then
  echo "REGISTRY_PATH must be absolute: $REGISTRY_PATH" >&2
  exit 1
fi
export REGISTRY_PATH
mkdir -p "$(dirname "$REGISTRY_PATH")"

# One-time migration from the original in-repo registry location.
if [[ ! -e "$REGISTRY_PATH" && -f "$APP_DIR/data/registry.json" ]]; then
  cp "$APP_DIR/data/registry.json" "$REGISTRY_PATH"
fi

npm ci --omit=dev
npm test

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME" --cwd "$APP_DIR" --time
fi

pm2 save
curl -fsS http://127.0.0.1:${PORT:-3010}/healthz >/dev/null
