#!/usr/bin/env bash
# Wypisuje fragment konfiguracji nginxa dla object storage na stdout.
#
#   STORAGE=minio STORAGE_BUCKET=rezervio-photos bash nginx-storage-snippet.sh
#
# Osobny skrypt, bo używają go dwie rzeczy: setup.sh na droplecie i CI, które
# przepuszcza wynik przez `nginx -t`. Wygenerowany fragment konfiguracji, którego
# nikt nie sprawdza, to nieudany deploy odkryty dopiero przy `systemctl reload`.
set -euo pipefail

STORAGE="${STORAGE:-external}"
STORAGE_BUCKET="${STORAGE_BUCKET:-rezervio-photos}"
STORAGE_HOST_PORT="${STORAGE_HOST_PORT:-9000}"

if [ "$STORAGE" != "minio" ]; then
  echo "# Storage jest zewnętrzny (Spaces) — nic tu nie proxujemy."
  exit 0
fi

# Bucket jest pierwszym segmentem ścieżki i nic go nie przepisuje: presigned
# PUT podpisuje host i pełną ścieżkę, więc bajty, które weryfikuje MinIO, muszą
# być bajtami, które wysłała przeglądarka. Obetnij albo zmień tu cokolwiek
# i każdy upload kończy się SignatureDoesNotMatch.
cat <<CONF
location /$STORAGE_BUCKET/ {
    proxy_pass http://127.0.0.1:$STORAGE_HOST_PORT;
    proxy_http_version 1.1;
    # Musi być adresem, dla którego URL został podpisany.
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # Zdjęcia, nie JSON. Strumieniowane, nie buforowane najpierw na dysk.
    client_max_body_size 25m;
    proxy_request_buffering off;
    proxy_read_timeout 120s;

    # Klucz obiektu niesie UUID, więc zapisane zdjęcie nigdy nie zmienia się
    # pod swoim kluczem.
    add_header Cache-Control "public, max-age=31536000, immutable";
}
CONF
