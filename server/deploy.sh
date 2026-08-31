#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/operator/markt.digitalisierungsplanung.de}"
APP_NAME="${APP_NAME:-dp-market}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/ChristianHohlfeld/markt.digitalisierungsplanung.de.git}"
DEPLOY_COMMIT="${DEPLOY_COMMIT:-}"
DEFAULT_REGISTRY_PATH="/home/operator/.local/share/dp-market/registry.json"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_RETRY_DELAY="${HEALTH_RETRY_DELAY:-1}"
NODE_MAJOR="${NODE_MAJOR:-24}"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[[ -d "$APP_DIR/.git" ]] || die "missing checkout: $APP_DIR"
for command in git node npm pm2 curl; do command -v "$command" >/dev/null 2>&1 || die "missing command: $command"; done
[[ "$(node -p 'process.versions.node.split(".")[0]')" == "$NODE_MAJOR" ]] || die "shared production host must run Node.js ${NODE_MAJOR}.x"
cd "$APP_DIR"

[[ -f .env ]] || die "missing $APP_DIR/.env"
set -a
# shellcheck disable=SC1091
source ./.env
set +a

REGISTRY_PATH="${REGISTRY_PATH:-$DEFAULT_REGISTRY_PATH}"
[[ "$REGISTRY_PATH" = /* ]] || die "REGISTRY_PATH must be absolute: $REGISTRY_PATH"
export REGISTRY_PATH
install -d -m 0700 "$(dirname "$REGISTRY_PATH")"

# One-time migration from the retired in-repo registry location.
if [[ ! -e "$REGISTRY_PATH" && -f "$APP_DIR/data/registry.json" ]]; then
  install -m 0600 "$APP_DIR/data/registry.json" "$REGISTRY_PATH"
fi
[[ ! -e "$REGISTRY_PATH" ]] || chmod 0600 "$REGISTRY_PATH"

if [[ -n "$DEPLOY_COMMIT" ]]; then
  [[ "$DEPLOY_COMMIT" =~ ^[a-fA-F0-9]{40}$ ]] || die "DEPLOY_COMMIT must be a 40-character Git commit"
  log "Syncing tested commit $DEPLOY_COMMIT."
  git remote set-url origin "$REPO_URL"
  git fetch --no-tags --prune --force origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
  [[ "$(git rev-parse "refs/remotes/origin/${BRANCH}")" == "$DEPLOY_COMMIT" ]] || die "tested commit is no longer origin/$BRANCH; newer workflow owns production"
  git cat-file -e "${DEPLOY_COMMIT}^{commit}" 2>/dev/null || die "tested commit unavailable after fetch"
  git reset --hard
  git clean -ffdx -e .env
  git checkout -B "$BRANCH" "$DEPLOY_COMMIT"
  git reset --hard "$DEPLOY_COMMIT"
fi

npm ci --omit=dev --no-audit --no-fund
npm test

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME" --cwd "$APP_DIR" --time
fi
pm2 save

healthy=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-3010}/healthz" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep "$HEALTH_RETRY_DELAY"
done
[[ "$healthy" == "1" ]] || die "marketplace health check failed"

log "dp-market is live and healthy on Node $(node --version)."
