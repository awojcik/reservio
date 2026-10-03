#!/usr/bin/env bash
# Rezervio — go back to the previous release.
#
#   ./rollback.sh                 # the release before the current one
#   ./rollback.sh <40-hex-sha>    # a specific one
#
# This is the fast path for an operator already on the droplet. The supported
# route is still GitHub → Actions → Deploy Production → git_ref = <old SHA>,
# because that leaves a record of who rolled back what and when.
#
# What this does NOT do, and cannot:
#
#   A rollback moves the application back. It does not move the database
#   back. If the release being undone added a column the old code ignores,
#   there is nothing to do. If it *dropped* or *rewrote* something, the old
#   code meets a schema it was never built for, and the only way out is the
#   backup. That is exactly why production migrations are expected to be
#   backward-compatible with the previous release (DEPLOY.md → Migracje).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/rezervio}"
HISTORY="$APP_DIR/releases.log"
ENV_FILE="$APP_DIR/.env"

log()  { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m    %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!!! %s\033[0m\n" "$*" >&2; exit 1; }

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  [ -f "$ENV_FILE" ] || die "Brak $ENV_FILE — nie wiem, co jest wdrożone."
  [ -f "$HISTORY" ] || die "Brak $HISTORY — podaj SHA ręcznie."

  current=$(grep -E '^RELEASE_SHA=' "$ENV_FILE" | cut -d= -f2- || true)

  # The most recent release in the log that is not the one running now.
  #
  # Not "whatever the current entry calls its previous": redeploying the same
  # SHA — a retry, a re-run of the workflow — writes previous=itself, and
  # rolling back to the release you are already on is the one answer that
  # helps nobody.
  TARGET=$(awk -v cur="$current" -F'\t' '$2 != cur { last = $2 } END { print last }' "$HISTORY")

  if [ -z "$TARGET" ] || [ "$TARGET" = "none" ]; then
    die "W $HISTORY nie ma innego wydania niż $current — podaj SHA ręcznie."
  fi
fi

[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || die "Podaj pełny, 40-znakowy SHA: $TARGET"

CURRENT=$(grep -E '^RELEASE_SHA=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "nieznane")

log "Cofam $CURRENT → $TARGET"
warn "Migracje NIE są cofane. Jeśli wydanie $CURRENT zmieniło schemat"
warn "w sposób niezgodny wstecz, przywróć bazę z backupu (backup.sh restore)."

RELEASE_SHA="$TARGET" exec "$APP_DIR/deploy.sh" --skip-migrations
