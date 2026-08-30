#!/usr/bin/env bash
# Rezervio — build + restart. Run after every change:
#   bash /root/reservio/deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/root/reservio}"
cd "$APP_DIR"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

if [ "${1:-}" != "--no-pull" ] && [ -d .git ]; then
  log "Pobieram zmiany z GitHuba"
  git pull --ff-only
fi

log "Zależności"
pnpm install --frozen-lockfile

log "Build"
pnpm --filter @rezervio/web build

# `output: standalone` emits the server but not the assets it serves.
# The targets must be removed first: `cp -r a b` nests a *inside* b when b exists.
log "Kopiuję assety do standalone"
WEB=apps/web
rm -rf "$WEB/.next/standalone/apps/web/.next/static" "$WEB/.next/standalone/apps/web/public"
cp -r "$WEB/.next/static" "$WEB/.next/standalone/apps/web/.next/static"
[ -d "$WEB/public" ] && cp -r "$WEB/public" "$WEB/.next/standalone/apps/web/public"

log "Restart usługi"
systemctl restart rezervio
sleep 2

if systemctl is-active --quiet rezervio; then
  log "Działa — $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:"${PORT:-3000}"/) na porcie ${PORT:-3000}"
else
  log "Usługa nie wstała — ostatnie logi:"
  journalctl -u rezervio -n 40 --no-pager
  exit 1
fi
