#!/usr/bin/env bash
# Rezervio — release a build to production.
#
# Runs on the droplet, as the unprivileged `rezervio` user, from /opt/rezervio.
# GitHub Actions copies this file next to compose.prod.yml and invokes it over
# SSH; a human can run exactly the same thing by hand.
#
#   RELEASE_SHA=<40 hex> ./deploy.sh
#   RELEASE_SHA=<40 hex> ./deploy.sh --skip-migrations     # used by rollback
#
# It never builds anything. Images come from GHCR by immutable tag, so what
# runs here is byte-identical to what CI tested.
#
# Order matters and is not negotiable:
#   pull → data services → migrate (under a lock) → app services → health
#
# A failure at any step leaves the previous release running, prints the last
# logs, and exits non-zero. There is no "deployed with warnings".
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/rezervio}"
COMPOSE_FILE="$APP_DIR/compose.prod.yml"
# Object storage on the droplet instead of Spaces. Its presence is the
# switch: no file, no MinIO, no dangling container after moving to Spaces.
STORAGE_FILE="$APP_DIR/compose.storage.yml"
ENV_FILE="$APP_DIR/.env"
APP_ENV_FILE="$APP_DIR/.env.production"
LOCK_FILE="$APP_DIR/.migrate.lock"
HISTORY="$APP_DIR/releases.log"

REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-awojcik/rezervio}"
RELEASE_SHA="${RELEASE_SHA:-}"

# How long each service gets to answer before the release is called failed.
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

# The loopback ports nginx proxies to, and the container names compose gives
# the services. Overridable so the same script can be rehearsed beside a
# running stack; production leaves all of them alone.
WEB_HOST_PORT="${WEB_HOST_PORT:-3000}"
API_HOST_PORT="${API_HOST_PORT:-3001}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-rezervio-postgres}"
WORKER_CONTAINER="${WORKER_CONTAINER:-rezervio-worker}"

SKIP_MIGRATIONS=0
for arg in "$@"; do
  case "$arg" in
    --skip-migrations) SKIP_MIGRATIONS=1 ;;
    *) echo "Nieznany argument: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m    %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!!! %s\033[0m\n" "$*" >&2; exit 1; }

# The compose file names `.env.production` relatively and Compose reads `.env`
# from the project directory. Both resolve against where we stand, so stand
# somewhere definite rather than wherever the caller happened to be.
cd "$APP_DIR" || die "Nie mogę wejść do $APP_DIR."

# ------------------------------------------------------------------ compose
# `podman compose` needs an external provider; podman-compose is what setup.sh
# installs. Resolved once so every call below is identical.
COMPOSE_FILES=(-f "$COMPOSE_FILE")
[ -f "$STORAGE_FILE" ] && COMPOSE_FILES+=(-f "$STORAGE_FILE")

if podman compose version >/dev/null 2>&1; then
  compose() { podman compose "${COMPOSE_FILES[@]}" "$@"; }
elif command -v podman-compose >/dev/null 2>&1; then
  compose() { podman-compose "${COMPOSE_FILES[@]}" "$@"; }
else
  die "Brak providera Compose. Uruchom deploy/setup.sh na tym hoście."
fi

# ------------------------------------------------------------------ checks
[ -n "$RELEASE_SHA" ] || die "RELEASE_SHA jest wymagany (pełny, 40-znakowy SHA)."
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA musi być pełnym SHA commita: $RELEASE_SHA"
[ -f "$COMPOSE_FILE" ] || die "Brak $COMPOSE_FILE."
[ -f "$APP_ENV_FILE" ] || die "Brak $APP_ENV_FILE — skopiuj deploy/env.production.example i uzupełnij."

# The application secrets live in this file. World-readable, they are not
# secrets at all, and a deploy is the last moment anyone looks.
perms=$(stat -c '%a' "$APP_ENV_FILE" 2>/dev/null || stat -f '%A' "$APP_ENV_FILE")
[ "$perms" = "600" ] || die ".env.production ma prawa $perms — wymagane 600 (chmod 600 $APP_ENV_FILE)."

API_IMAGE="$REGISTRY/$IMAGE_NAMESPACE/api:$RELEASE_SHA"
WEB_IMAGE="$REGISTRY/$IMAGE_NAMESPACE/web:$RELEASE_SHA"
PG_IMAGE="$REGISTRY/$IMAGE_NAMESPACE/postgres:$RELEASE_SHA"

PREVIOUS_SHA=""
[ -f "$ENV_FILE" ] && PREVIOUS_SHA=$(grep -E '^RELEASE_SHA=' "$ENV_FILE" | cut -d= -f2- || true)

log "Wydanie $RELEASE_SHA"
[ -n "$PREVIOUS_SHA" ] && echo "    poprzednie: $PREVIOUS_SHA"
[ "$SKIP_MIGRATIONS" = "1" ] && warn "Migracje pominięte (--skip-migrations)."

# ------------------------------------------------------------------ pull
# Before anything is stopped or changed. A tag that does not exist must fail
# here, with the previous release still serving traffic.
log "Pobieram obrazy"
for image in "$PG_IMAGE" "$API_IMAGE" "$WEB_IMAGE"; do
  echo "    $image"
  podman pull -q "$image" >/dev/null || die "Nie udało się pobrać $image. Czy CI zbudowało ten SHA?"
done

# ------------------------------------------------------------------ env
# Written only once every image is in hand, so a failed pull cannot leave the
# stack pointing at a release that is not on disk.
log "Zapisuję wersję wydania"
umask 077
{
  echo "# Zapisane przez deploy.sh — nie edytuj ręcznie."
  echo "# Wartości aplikacji są w .env.production."
  echo "REGISTRY=$REGISTRY"
  echo "IMAGE_NAMESPACE=$IMAGE_NAMESPACE"
  echo "RELEASE_SHA=$RELEASE_SHA"
  # Read by compose for the postgres container; the same credentials appear in
  # DATABASE_URL inside .env.production and must not drift from it.
  echo "WEB_HOST_PORT=$WEB_HOST_PORT"
  echo "API_HOST_PORT=$API_HOST_PORT"
  # MinIO reads its root credentials from the same two variables the API
  # signs with; they must be one value, not two that drift.
  grep -E '^(POSTGRES_USER|POSTGRES_DB|POSTGRES_PASSWORD|WORKER_CONCURRENCY|REDIS_MAXMEMORY|API_HEAP_MB|WORKER_HEAP_MB|WEB_HEAP_MB|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|STORAGE_HOST_PORT)=' \
    "$APP_ENV_FILE" || true
} > "$ENV_FILE.next"
mv "$ENV_FILE.next" "$ENV_FILE"

# ------------------------------------------------------------------ data
log "PostgreSQL i Redis"
compose up -d postgres redis

if [ -f "$STORAGE_FILE" ]; then
  # Before the API: it creates the bucket and its public-read policy at boot,
  # and only at boot.
  log "Object storage (MinIO na droplecie)"
  compose up -d minio
fi

printf "    czekam na PostgreSQL"
for _ in $(seq 1 60); do
  if podman exec "$POSTGRES_CONTAINER" pg_isready -q 2>/dev/null; then
    printf " gotowy\n"; break
  fi
  printf "."; sleep 2
done
podman exec "$POSTGRES_CONTAINER" pg_isready -q 2>/dev/null \
  || die "PostgreSQL nie odpowiada. Logi: podman logs $POSTGRES_CONTAINER"

# ------------------------------------------------------------------ migrate
if [ "$SKIP_MIGRATIONS" = "0" ]; then
  log "Migracje"
  # flock, because two deploys started a minute apart would otherwise race the
  # same schema. The second waits; it does not run in parallel and it does not
  # silently skip. Its absence is its own error: "no lock" and "lock held by
  # someone else" must never look the same.
  command -v flock >/dev/null 2>&1 \
    || die "Brak flock (util-linux) — nie umiem zagwarantować, że migracje nie pójdą równolegle."

  exec 9>"$LOCK_FILE"
  flock -w 300 9 || die "Inna migracja trwa dłużej niż 5 minut — przerwane."

  compose run --rm --no-deps api node dist/infrastructure/database/migrate.js \
    || die "Migracja nie przeszła. Poprzednie wydanie nadal działa — nic nie zostało przełączone."

  flock -u 9
  exec 9>&-
fi

# ------------------------------------------------------------------ app
log "API, worker i web"
compose up -d --remove-orphans

# ------------------------------------------------------------------ health
# The release is not a success until the new containers answer. Polled from
# the droplet itself, against the loopback ports nginx uses.
probe() {
  local name="$1" url="$2" deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  printf "    %-22s" "$name"
  while [ $SECONDS -lt $deadline ]; do
    if curl -fs -o /dev/null --max-time 5 "$url" 2>/dev/null; then
      printf " ok\n"; return 0
    fi
    printf "."; sleep 3
  done
  printf " FAIL\n"; return 1
}

log "Health checks"
failed=""
probe "api /api/health"  "http://127.0.0.1:$API_HOST_PORT/api/health" || failed="api"
probe "api /api/ready"   "http://127.0.0.1:$API_HOST_PORT/api/ready"  || failed="${failed:-api-ready}"
probe "web /"            "http://127.0.0.1:$WEB_HOST_PORT/"          || failed="${failed:-web}"

if [ -n "$failed" ]; then
  warn "Ostatnie logi (bez sekretów — aplikacja redaguje je u źródła):"
  compose logs --tail 60 api worker web 2>&1 | tail -120 || true
  die "Health check nie przeszedł ($failed). Wydanie $RELEASE_SHA NIE jest sprawne.
    Cofnięcie: RELEASE_SHA=$PREVIOUS_SHA ./deploy.sh --skip-migrations"
fi

# The worker has no endpoint to poll — it serves nobody. That it is up is the
# whole claim, and compose is the thing that knows.
if ! podman ps --filter "name=^${WORKER_CONTAINER}$" --filter status=running \
     --format '{{.Names}}' | grep -qx "$WORKER_CONTAINER"; then
  compose logs --tail 60 worker 2>&1 | tail -60 || true
  die "Worker nie działa."
fi
echo "    worker                 ok"

# ------------------------------------------------------------------ record
printf '%s\t%s\tprevious=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RELEASE_SHA" "${PREVIOUS_SHA:-none}" >> "$HISTORY"

# Keep the previous release's images: rollback pulls nothing if they are still
# here. Everything older than that is disk this droplet does not have.
log "Sprzątanie starych obrazów"
podman image prune -f --filter "until=72h" >/dev/null 2>&1 || true

log "Wydanie $RELEASE_SHA działa."
echo "    web:  http://127.0.0.1:$WEB_HOST_PORT/"
echo "    api:  http://127.0.0.1:$API_HOST_PORT/api/health"
echo "    logi: podman compose -f $COMPOSE_FILE logs -f api"
