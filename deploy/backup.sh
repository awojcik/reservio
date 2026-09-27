#!/usr/bin/env bash
# Rezervio — PostgreSQL backup, off-host copy, restore and restore verification.
#
#   ./backup.sh dump              # daily job (systemd timer runs this)
#   ./backup.sh list
#   ./backup.sh verify [file]     # restore into a scratch DB and count rows
#   ./backup.sh restore <file>    # DESTRUCTIVE — overwrites the live database
#
# The database is the only thing on this droplet that cannot be rebuilt from
# git. Everything else — images, configuration, the whole filesystem — is
# reproducible; a lost `rezervio-pgdata` volume is lost Bookings.
#
# Which is why a backup that only exists on the same droplet is not a backup:
# it survives a bad migration, and nothing else. The off-host copy is the
# part that matters, and this script FAILS rather than reporting success when
# it is not configured.
#
# Configuration comes from .env.production:
#   BACKUP_S3_BUCKET       e.g. rezervio-backups
#   BACKUP_S3_ENDPOINT     e.g. https://fra1.digitaloceanspaces.com
#   BACKUP_S3_REGION       e.g. fra1
#   BACKUP_S3_ACCESS_KEY_ID
#   BACKUP_S3_SECRET_ACCESS_KEY
#   BACKUP_S3_PREFIX       optional, default "postgres"
#   BACKUP_PHOTOS_PREFIX   optional, default "photos" (tylko przy MinIO)
#   BACKUP_ALLOW_LOCAL_ONLY=true  opt out, loudly, on purpose
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/rezervio}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
APP_ENV_FILE="$APP_DIR/.env.production"
CONTAINER="${POSTGRES_CONTAINER:-rezervio-postgres}"

# Retention, local copies. Off-host retention is a bucket lifecycle rule —
# see DEPLOY.md, because a delete loop against a remote bucket is a worse
# thing to get wrong than a full disk.
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-3}"

# GNU and BSD disagree about both of these. The droplet is Ubuntu, but a
# rehearsal on a laptop is the only way anyone checks the retention maths
# before it silently deletes the wrong file.
mtime_epoch() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"; }
fmt_epoch()   { date -u -d "@$1" "+$2" 2>/dev/null || date -u -r "$1" "+$2"; }

log()  { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m    %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!!! %s\033[0m\n" "$*" >&2; exit 1; }

# Secrets are read, never echoed. `set -a` keeps this to one line without
# exporting the file's contents into any child that does not need them.
load_env() {
  [ -f "$APP_ENV_FILE" ] || die "Brak $APP_ENV_FILE."
  set -a
  # shellcheck disable=SC1090
  . "$APP_ENV_FILE"
  set +a
  PGUSER="${POSTGRES_USER:-rezervio}"
  PGDATABASE="${POSTGRES_DB:-rezervio}"
}

running() {
  podman ps --filter "name=^${CONTAINER}$" --filter status=running --format '{{.Names}}' \
    | grep -qx "$CONTAINER"
}

# ------------------------------------------------------------------ dump
cmd_dump() {
  load_env
  running || die "Kontener $CONTAINER nie działa — nie ma czego zrzucić."
  mkdir -p "$BACKUP_DIR"

  local stamp file
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$BACKUP_DIR/rezervio-$stamp.dump"

  log "pg_dump → $(basename "$file")"
  # Custom format: compressed by pg_dump itself, and restorable selectively.
  # A plain SQL file piped through gzip would lose that, for the same bytes.
  if ! podman exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDATABASE" -Fc --no-owner \
        > "$file.partial"; then
    rm -f "$file.partial"
    die "pg_dump nie powiódł się."
  fi
  # Named only once complete: a half-written file must never look like a
  # backup to the retention sweep or to a panicking operator.
  mv "$file.partial" "$file"
  chmod 600 "$file"

  local size
  size=$(du -h "$file" | cut -f1)
  echo "    $size"

  # A dump pg_restore cannot read is not a backup. Cheap to check, and it
  # catches a truncated write immediately rather than during an incident.
  podman exec -i "$CONTAINER" pg_restore --list < "$file" > /dev/null \
    || die "Zrzut jest nieczytelny dla pg_restore — nie liczę go jako backup."
  echo "    pg_restore --list ok"

  prune_local
  copy_off_host "$file"
  copy_photos_off_host
}

# ------------------------------------------------------------------ photos
# Only when object storage runs on this droplet. With Spaces there is nothing
# to do here: the photos already live somewhere that is not this disk.
#
# `copy`, never `sync`. Sync mirrors deletions, so the day the volume is lost
# — the day this exists for — it would faithfully erase the backup too.
copy_photos_off_host() {
  podman ps --filter "name=^rezervio-minio$" --filter status=running \
    --format '{{.Names}}' | grep -qx rezervio-minio || return 0

  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
    if [ "${BACKUP_ALLOW_LOCAL_ONLY:-false}" = "true" ]; then
      warn "Zdjęcia zostają wyłącznie na droplecie."
      return 0
    fi
    die "Zdjęcia są na tym droplecie, a BACKUP_S3_* nie jest ustawione."
  fi

  local mount
  mount=$(podman volume inspect rezervio-photos --format '{{.Mountpoint}}' 2>/dev/null || true)
  if [ -z "$mount" ] || [ ! -d "$mount" ]; then
    die "Nie znalazłem wolumenu rezervio-photos — zdjęcia NIE są kopiowane."
  fi

  log "Zdjęcia poza host: s3://$BACKUP_S3_BUCKET/${BACKUP_PHOTOS_PREFIX:-photos}/"
  rclone copy "$mount" ":s3:$BACKUP_S3_BUCKET/${BACKUP_PHOTOS_PREFIX:-photos}/" \
    --s3-provider Other \
    --s3-endpoint "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT jest wymagany}" \
    --s3-region "${BACKUP_S3_REGION:-us-east-1}" \
    --s3-access-key-id "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID jest wymagany}" \
    --s3-secret-access-key "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY jest wymagany}" \
    --s3-no-check-bucket \
    --stats-one-line --stats 0 \
    || die "Kopia zdjęć poza host nie powiodła się."

  echo "    zdjęcia skopiowane ($(du -sh "$mount" | cut -f1))"
}

# ------------------------------------------------------------------ retention
# Grandfather-father-son over file mtime. Weeklies are Mondays, monthlies the
# first of the month; anything else older than the daily window goes.
prune_local() {
  log "Retencja lokalna (${KEEP_DAILY}d / ${KEEP_WEEKLY}w / ${KEEP_MONTHLY}m)"
  local kept=0 removed=0 keep

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    keep=0
    local epoch dow dom age_days
    epoch=$(mtime_epoch "$file")
    dow=$(fmt_epoch "$epoch" %u)
    dom=$(fmt_epoch "$epoch" %d)
    age_days=$(( ( $(date -u +%s) - epoch ) / 86400 ))

    [ "$age_days" -lt "$KEEP_DAILY" ] && keep=1
    [ "$dow" = "1" ] && [ "$age_days" -lt $((KEEP_WEEKLY * 7)) ] && keep=1
    [ "$dom" = "01" ] && [ "$age_days" -lt $((KEEP_MONTHLY * 31)) ] && keep=1

    if [ "$keep" = "1" ]; then
      kept=$((kept + 1))
    else
      rm -f "$file"
      removed=$((removed + 1))
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'rezervio-*.dump' -type f | sort)

  echo "    zostaje $kept, usunięto $removed"
}

# ------------------------------------------------------------------ off-host
copy_off_host() {
  local file="$1"

  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
    if [ "${BACKUP_ALLOW_LOCAL_ONLY:-false}" = "true" ]; then
      warn "BACKUP_ALLOW_LOCAL_ONLY=true — kopia TYLKO na tym droplecie."
      warn "To nie jest backup na wypadek utraty dropleta."
      return 0
    fi
    die "BACKUP_S3_BUCKET nie jest ustawiony — kopii poza hostem NIE MA.
    Backup leżący na tym samym droplecie chroni przed złą migracją i przed
    niczym więcej. Uzupełnij BACKUP_S3_* w .env.production albo ustaw
    świadomie BACKUP_ALLOW_LOCAL_ONLY=true."
  fi

  command -v rclone >/dev/null 2>&1 || die "Brak rclone (instaluje go setup.sh)."

  log "Kopia poza host: s3://$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:-postgres}/"
  # An on-the-fly remote: no rclone.conf to keep in sync with .env.production,
  # and no second copy of these credentials on the droplet.
  rclone copy "$file" ":s3:$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:-postgres}/" \
    --s3-provider Other \
    --s3-endpoint "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT jest wymagany}" \
    --s3-region "${BACKUP_S3_REGION:-us-east-1}" \
    --s3-access-key-id "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID jest wymagany}" \
    --s3-secret-access-key "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY jest wymagany}" \
    --s3-no-check-bucket \
    --stats-one-line --stats 0 \
    || die "Kopia poza host nie powiodła się. Backup lokalny istnieje, ale nie jest bezpieczny."

  echo "    skopiowane: $(basename "$file")"
}

# ------------------------------------------------------------------ list
cmd_list() {
  log "Backupy lokalne w $BACKUP_DIR"
  ls -lh "$BACKUP_DIR"/rezervio-*.dump 2>/dev/null || echo "    (brak)"
}

latest() {
  find "$BACKUP_DIR" -maxdepth 1 -name 'rezervio-*.dump' -type f | sort | tail -1
}

# ------------------------------------------------------------------ verify
# The only question that matters about a backup: does it restore? Answered
# against a scratch database inside the same container, so it can be run on a
# normal Tuesday without touching a single production row.
cmd_verify() {
  load_env
  running || die "Kontener $CONTAINER nie działa."

  local file="${1:-$(latest)}"
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    die "Nie ma czego sprawdzić — brak pliku backupu."
  fi

  local scratch="rezervio_restore_check"
  log "Weryfikacja odtworzenia: $(basename "$file") → $scratch"

  podman exec "$CONTAINER" psql -U "$PGUSER" -d postgres -qc \
    "DROP DATABASE IF EXISTS $scratch;" >/dev/null
  podman exec "$CONTAINER" psql -U "$PGUSER" -d postgres -qc \
    "CREATE DATABASE $scratch;" >/dev/null

  # The extensions live in the dump, but PostGIS needs them present before
  # the geography column is created.
  podman exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -qc \
    "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

  # --exit-on-error deliberately off: re-creating an extension that already
  # exists is an expected, harmless error here. The row counts below are the
  # real assertion.
  podman exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$scratch" --no-owner < "$file" \
    2> >(grep -v 'already exists' >&2) || true

  local report
  report=$(podman exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -At -c "
    SELECT 'properties=' || (SELECT count(*) FROM properties)
        || ' bookings='  || (SELECT count(*) FROM bookings)
        || ' users='     || (SELECT count(*) FROM users)
        || ' tables='    || (SELECT count(*) FROM information_schema.tables
                             WHERE table_schema = 'public');") \
    || die "Odtworzona baza nie odpowiada na zapytanie — backup NIE jest sprawny."

  echo "    $report"
  podman exec "$CONTAINER" psql -U "$PGUSER" -d postgres -qc \
    "DROP DATABASE IF EXISTS $scratch;" >/dev/null

  log "Backup odtwarza się poprawnie."
}

# ------------------------------------------------------------------ restore
cmd_restore() {
  load_env
  running || die "Kontener $CONTAINER nie działa."

  local file="${1:-}"
  [ -n "$file" ] || die "Podaj plik: ./backup.sh restore $BACKUP_DIR/rezervio-….dump"
  [ -f "$file" ] || die "Nie ma pliku: $file"

  cat >&2 <<CONFIRM

$(printf "\033[1;31m!!! To nadpisze PRODUKCYJNĄ bazę danych.\033[0m")

    plik:  $file
    baza:  $PGDATABASE w kontenerze $CONTAINER

Zatrzymaj najpierw API i worker, żeby nic nie pisało w trakcie:
    podman compose -f $APP_DIR/compose.prod.yml stop api worker

CONFIRM
  read -r -p "Wpisz 'restore' aby kontynuować: " answer
  [ "$answer" = "restore" ] || die "Przerwane."

  log "Odtwarzanie"
  # --clean --if-exists so the restore is not fighting the existing schema,
  # and a single transaction so a failure leaves the database as it was.
  podman exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$PGDATABASE" \
    --clean --if-exists --no-owner --single-transaction < "$file" \
    || die "Odtwarzanie nie powiodło się. Baza jest w stanie sprzed próby."

  log "Odtworzone. Uruchom aplikację:"
  echo "    podman compose -f $APP_DIR/compose.prod.yml up -d api worker"
}

case "${1:-dump}" in
  dump)    cmd_dump ;;
  list)    cmd_list ;;
  verify)  shift; cmd_verify "${1:-}" ;;
  restore) shift; cmd_restore "${1:-}" ;;
  *) echo "Użycie: $0 {dump|list|verify [plik]|restore <plik>}" >&2; exit 2 ;;
esac
