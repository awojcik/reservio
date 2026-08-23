#!/usr/bin/env bash
# Rezervio — certyfikat Let's Encrypt dla rezervio.pl i www.rezervio.pl.
#
#   bash /root/reservio/deploy/tls.sh
#   EMAIL=ty@example.com bash /root/reservio/deploy/tls.sh   # bez pytań
#
# Wymaga rekordów A wskazujących na tego dropleta. Odnowienia obsługuje
# timer systemd instalowany razem z certbotem — nic nie trzeba dopisywać do crona.
set -euo pipefail

DOMAIN="${DOMAIN:-rezervio.pl}"
EMAIL="${EMAIL:-}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root."; exit 1; }

if ! command -v certbot >/dev/null 2>&1; then
  log "Instaluję certbot"
  snap install core >/dev/null 2>&1 || true
  snap refresh core >/dev/null 2>&1 || true
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi

# www is optional: request it only when it resolves, otherwise the whole
# certificate request fails because of one missing record.
domains=(-d "$DOMAIN")
if getent ahostsv4 "www.$DOMAIN" >/dev/null 2>&1; then
  domains+=(-d "www.$DOMAIN")
  log "Certyfikat dla $DOMAIN i www.$DOMAIN"
else
  log "Certyfikat dla $DOMAIN (www.$DOMAIN się nie rozwiązuje — pomijam)"
fi

if [ -n "$EMAIL" ]; then
  certbot --nginx "${domains[@]}" \
    --non-interactive --agree-tos --email "$EMAIL" --redirect
else
  # Interactive: certbot asks for an e-mail and the terms.
  certbot --nginx "${domains[@]}" --redirect
fi

log "Test odnowienia"
certbot renew --dry-run

log "HTTPS gotowe: https://$DOMAIN"
