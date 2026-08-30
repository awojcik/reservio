#!/usr/bin/env bash
# Local infrastructure for Rezervio: PostgreSQL (PostGIS + pg_trgm + pgvector),
# an S3-compatible object storage (MinIO), Redis (BullMQ queue only —
# Availability itself is never stored there) and Mailpit, which captures every
# email the app sends locally so nothing reaches a real inbox.
#
# `podman compose` needs an external provider (docker-compose or podman-compose)
# that is not installed on every machine, so this script uses it when it is
# available and falls back to plain `podman run` with the same parameters as
# compose.yml. Docker Desktop is never required.
#
# Every port is bound to 127.0.0.1, not 0.0.0.0: the bucket is public-read, so
# a wildcard bind would hand uploaded Property photos to anyone on the same
# network. Local development needs the loopback interface and nothing more.
#
# Usage: scripts/infra.sh start|stop|reset
set -euo pipefail

PG_IMAGE="localhost/rezervio-postgres:17"
MINIO_IMAGE="docker.io/minio/minio:RELEASE.2025-04-22T22-12-26Z"
REDIS_IMAGE="docker.io/library/redis:7-alpine"
MAILPIT_IMAGE="docker.io/axllent/mailpit:v1.21"
DB_NAME="rezervio-db"
STORAGE_NAME="rezervio-object-storage"
REDIS_NAME="rezervio-redis"
MAILPIT_NAME="rezervio-mailpit"
PG_VOLUME="rezervio-pgdata"
MINIO_VOLUME="rezervio-minio"
REDIS_VOLUME="rezervio-redis"

require_podman() {
  if ! command -v podman >/dev/null 2>&1; then
    echo "Podman nie jest zainstalowany. Zobacz README (sekcja Wymagania)." >&2
    exit 1
  fi

  if ! podman info >/dev/null 2>&1; then
    echo "Podman nie odpowiada. Na macOS uruchom maszynę:" >&2
    echo "  podman machine init   # tylko przy pierwszym uruchomieniu" >&2
    echo "  podman machine start" >&2
    exit 1
  fi
}

has_compose_provider() {
  podman compose version >/dev/null 2>&1
}

build_images() {
  # Built with podman rather than through Compose on purpose: the external
  # Compose provider may be Docker's, which needs a credential helper that is
  # not installed on every machine. Podman uses its own auth store.
  if ! podman image exists "$PG_IMAGE"; then
    echo "==> Buduję obraz $PG_IMAGE (jednorazowo, kilka minut)"
    podman build -t "$PG_IMAGE" -f containers/postgres/Containerfile containers/postgres
  fi

  if ! podman image exists "$MINIO_IMAGE"; then
    echo "==> Pobieram obraz $MINIO_IMAGE (jednorazowo)"
    podman pull "$MINIO_IMAGE"
  fi

  if ! podman image exists "$REDIS_IMAGE"; then
    echo "==> Pobieram obraz $REDIS_IMAGE (jednorazowo)"
    podman pull "$REDIS_IMAGE"
  fi

  if ! podman image exists "$MAILPIT_IMAGE"; then
    echo "==> Pobieram obraz $MAILPIT_IMAGE (jednorazowo)"
    podman pull "$MAILPIT_IMAGE"
  fi
}

run_container() {
  local name="$1"
  shift

  if podman container exists "$name"; then
    # `podman start` on a running container is a no-op, so this is safe to repeat.
    podman start "$name" >/dev/null
  else
    podman run -d --name "$name" "$@" >/dev/null
  fi
  echo "==> $name działa"
}

start_with_podman_run() {
  podman volume exists "$PG_VOLUME" || podman volume create "$PG_VOLUME" >/dev/null
  podman volume exists "$MINIO_VOLUME" || podman volume create "$MINIO_VOLUME" >/dev/null
  podman volume exists "$REDIS_VOLUME" || podman volume create "$REDIS_VOLUME" >/dev/null

  run_container "$DB_NAME" \
    -e POSTGRES_USER=rezervio \
    -e POSTGRES_PASSWORD=rezervio \
    -e POSTGRES_DB=rezervio \
    -p 127.0.0.1:5432:5432 \
    -v "$PG_VOLUME:/var/lib/postgresql/data" \
    --restart unless-stopped \
    "$PG_IMAGE"

  run_container "$STORAGE_NAME" \
    -e MINIO_ROOT_USER=rezervio \
    -e MINIO_ROOT_PASSWORD=rezervio-local-only \
    -e MINIO_API_CORS_ALLOW_ORIGIN='*' \
    -p 127.0.0.1:9000:9000 \
    -p 127.0.0.1:9001:9001 \
    -v "$MINIO_VOLUME:/data" \
    --restart unless-stopped \
    "$MINIO_IMAGE" server /data --console-address ":9001"

  run_container "$REDIS_NAME" \
    -p 127.0.0.1:6379:6379 \
    -v "$REDIS_VOLUME:/data" \
    --restart unless-stopped \
    "$REDIS_IMAGE" redis-server --appendonly yes

  # No volume: locally captured mail is disposable by design.
  run_container "$MAILPIT_NAME" \
    -e MP_MAX_MESSAGES=500 \
    -e MP_SMTP_AUTH_ACCEPT_ANY=1 \
    -e MP_SMTP_AUTH_ALLOW_INSECURE=1 \
    -p 127.0.0.1:1025:1025 \
    -p 127.0.0.1:8025:8025 \
    --restart unless-stopped \
    "$MAILPIT_IMAGE"
}

wait_for_database() {
  echo -n "==> Czekam na gotowość bazy"
  for _ in $(seq 1 60); do
    if podman exec "$DB_NAME" pg_isready -U rezervio -d rezervio >/dev/null 2>&1; then
      echo " — gotowa"
      return 0
    fi
    echo -n "."
    sleep 1
  done

  echo >&2
  echo "Baza nie wstała w ciągu 60 s. Logi: podman logs $DB_NAME" >&2
  exit 1
}

wait_for_redis() {
  echo -n "==> Czekam na gotowość Redis"
  for _ in $(seq 1 60); do
    if podman exec "$REDIS_NAME" redis-cli ping 2>/dev/null | grep -q PONG; then
      echo " — gotowy"
      return 0
    fi
    echo -n "."
    sleep 1
  done

  echo >&2
  echo "Redis nie wstał w ciągu 60 s. Logi: podman logs $REDIS_NAME" >&2
  exit 1
}

wait_for_mailpit() {
  echo -n "==> Czekam na gotowość Mailpit"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:8025/readyz"; then
      echo " — gotowy (skrzynka: http://localhost:8025)"
      return 0
    fi
    echo -n "."
    sleep 1
  done

  echo >&2
  echo "Mailpit nie wstał w ciągu 60 s. Logi: podman logs $MAILPIT_NAME" >&2
  exit 1
}

wait_for_storage() {
  echo -n "==> Czekam na gotowość object storage"
  for _ in $(seq 1 60); do
    # MinIO answers this endpoint as soon as it is ready to serve the S3 API.
    if curl -sf -o /dev/null "http://localhost:9000/minio/health/live"; then
      echo " — gotowe"
      return 0
    fi
    echo -n "."
    sleep 1
  done

  echo >&2
  echo "Object storage nie wstało w ciągu 60 s. Logi: podman logs $STORAGE_NAME" >&2
  exit 1
}

start() {
  require_podman
  build_images

  if has_compose_provider; then
    echo "==> Uruchamiam przez podman compose"
    podman compose up -d
  else
    echo "==> Brak providera compose — uruchamiam kontenery bezpośrednio przez podman"
    start_with_podman_run
  fi

  wait_for_database
  wait_for_storage
  wait_for_redis
  wait_for_mailpit
}

stop() {
  require_podman
  if has_compose_provider; then
    podman compose stop
  else
    podman stop "$DB_NAME" "$STORAGE_NAME" "$REDIS_NAME" "$MAILPIT_NAME" >/dev/null 2>&1 || true
  fi
  echo "==> Infrastruktura zatrzymana"
}

reset() {
  require_podman
  if has_compose_provider; then
    podman compose down -v
  else
    podman rm -f "$DB_NAME" "$STORAGE_NAME" "$REDIS_NAME" "$MAILPIT_NAME" >/dev/null 2>&1 || true
    podman volume rm "$PG_VOLUME" "$MINIO_VOLUME" "$REDIS_VOLUME" >/dev/null 2>&1 || true
  fi
  echo "==> Wolumeny usunięte — baza i storage wstaną od zera"
  start
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) reset ;;
  *)
    echo "Użycie: scripts/infra.sh start|stop|reset" >&2
    exit 1
    ;;
esac
