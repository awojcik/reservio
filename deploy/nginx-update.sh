#!/usr/bin/env bash
#
# Rezervio — aktualizacja samej konfiguracji nginx.
#
# Istnieje, bo wcześniej jedyną drogą do zmiany nginx było uruchomienie
# całego setup.sh — bootstrapu hosta, który zakłada użytkownika, instaluje
# pakiety, konfiguruje podmana i systemd. Dla podmiany jednego bloku
# `location` to jest nieproporcjonalne, a w praktyce zdjęło HTTPS: szablon i
# certbot dzielą jeden plik, więc każde uruchomienie go nadpisuje i zależy od
# jednego `certbot install`, który może zawieść.
#
# Ten skrypt robi wyłącznie nginx i nie dotyka niczego innego. setup.sh go
# woła, więc ta logika istnieje w jednym egzemplarzu.
#
#   bash nginx-update.sh                      # DOMAIN=rezervio.pl, STORAGE=external
#   DOMAIN=example.pl STORAGE=minio bash nginx-update.sh
#
# Kończy kodem 1, jeśli host serwował HTTPS, a po zmianie już nie serwuje —
# przywracając wtedy poprzedni plik. Utrata TLS to awaria, nie ostrzeżenie.

set -euo pipefail

DOMAIN="${DOMAIN:-rezervio.pl}"
WEB_HOST_PORT="${WEB_HOST_PORT:-3000}"
API_HOST_PORT="${API_HOST_PORT:-3001}"
STORAGE="${STORAGE:-external}"
STORAGE_BUCKET="${STORAGE_BUCKET:-rezervio-photos}"
STORAGE_HOST_PORT="${STORAGE_HOST_PORT:-9000}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m    %s\033[0m\n" "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  warn "Uruchom jako root (sudo)."
  exit 1
fi

log "Nginx (domena: $DOMAIN, storage: $STORAGE)"

# Zawsze, żeby include w nginx.conf zawsze się rozwiązywał — także wtedy, gdy
# storage jest zewnętrzny i nie ma czego proxować. Ten sam skrypt generuje ten
# fragment w CI, gdzie przechodzi przez `nginx -t`.
install -d -m 755 /etc/nginx/snippets
STORAGE="$STORAGE" STORAGE_BUCKET="$STORAGE_BUCKET" STORAGE_HOST_PORT="$STORAGE_HOST_PORT" \
  bash "$HERE/nginx-storage-snippet.sh" > /etc/nginx/snippets/rezervio-storage.conf

# Cache zoptymalizowanych zdjęć. Trafia do conf.d, bo `proxy_cache_path` i
# `map` należą do kontekstu `http`, a plik serwisu jest blokiem `server` — i
# plik serwisu odwołuje się do tej strefy, więc jej brak to twardy błąd
# `nginx -t`, a nie ciche pominięcie.
#
# Nginx tworzy ostatni katalog tej ścieżki i nic więcej, a Debian nie ma
# /var/cache/nginx — brakujący rodzic to `[emerg]` przy reloadzie.
install -d -o www-data -g www-data -m 755 /var/cache/nginx
install -m 644 "$HERE/nginx-image-cache.conf" /etc/nginx/conf.d/rezervio-image-cache.conf

if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
else
  SERVER_NAME="$DOMAIN www.$DOMAIN"
fi

# Certbot wpisuje swój blok `listen 443` i przekierowanie do tego samego
# pliku, więc nadpisanie szablonem zdejmuje HTTPS. Kopia jest obowiązkowa:
# szablon, który po cichu wyrzuca działającą konfigurację TLS, to najgorszy
# rodzaj idempotencji.
NGINX_BACKUP=""
HAD_TLS=0
if [ -f /etc/nginx/sites-available/rezervio ]; then
  NGINX_BACKUP="/etc/nginx/sites-available/rezervio.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a /etc/nginx/sites-available/rezervio "$NGINX_BACKUP"
  if grep -qE '^[[:space:]]*listen[[:space:]]+(\[::\]:)?443' /etc/nginx/sites-available/rezervio; then
    HAD_TLS=1
  fi
fi

sed -e "s|__SERVER_NAME__|$SERVER_NAME|g" \
    -e "s|__WEB_PORT__|$WEB_HOST_PORT|g" \
    -e "s|__API_PORT__|$API_HOST_PORT|g" \
  "$HERE/nginx.conf" > /etc/nginx/sites-available/rezervio
ln -sf /etc/nginx/sites-available/rezervio /etc/nginx/sites-enabled/rezervio
rm -f /etc/nginx/sites-enabled/default

# Blok należący do certbota został właśnie nadpisany razem z resztą, więc
# wraca na miejsce przed reloadem. `certbot install` edytuje tylko
# konfigurację serwera — żadnego żądania ACME, limitu ani pytania o e-mail.
if [ "$DOMAIN" != "_" ] && [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  log "Przywracam HTTPS z istniejącego certyfikatu"
  certbot install --cert-name "$DOMAIN" --nginx --non-interactive \
    || warn "certbot install zakończył się błędem"
fi

# Host, który serwował HTTPS i już nie serwuje, to awaria — nie linijka w
# logu, którą ktoś przeczyta później. Zdarzyło się to dwa razy.
if [ "$HAD_TLS" = 1 ] \
  && ! grep -qE '^[[:space:]]*listen[[:space:]]+(\[::\]:)?443' /etc/nginx/sites-available/rezervio; then
  warn "HTTPS zniknął z konfiguracji, a przed uruchomieniem skryptu działał."
  if [ -n "$NGINX_BACKUP" ]; then
    warn "Przywracam poprzednią konfigurację: $NGINX_BACKUP"
    cp -a "$NGINX_BACKUP" /etc/nginx/sites-available/rezervio
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx
      warn "HTTPS przywrócone, ale BEZ zmian z tego uruchomienia (np. cache zdjęć)."
    else
      warn "Przywrócona konfiguracja też nie przechodzi nginx -t — napraw ręcznie."
    fi
  fi
  warn "Dokończ przez: certbot install --cert-name $DOMAIN --nginx"
  exit 1
fi

nginx -t
systemctl reload nginx
log "Nginx przeładowany"
