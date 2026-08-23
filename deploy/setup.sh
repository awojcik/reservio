#!/usr/bin/env bash
# Rezervio — pierwsze wdrożenie na czystym dropletcie (Ubuntu, jako root).
#
#   apt-get update && apt-get install -y git
#   git clone https://github.com/awojcik/reservio.git
#   bash reservio/deploy/setup.sh
#
# Z własną domeną:  DOMAIN=example.com bash reservio/deploy/setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/root/reservio}"
DOMAIN="${DOMAIN:-rezervio.pl}"
PORT="${PORT:-3000}"
REPO="${REPO:-https://github.com/awojcik/reservio.git}"
# Optional: set EMAIL=... to obtain the certificate without any prompts.
EMAIL="${EMAIL:-}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root."; exit 1; }

log "Pakiety systemowe"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ca-certificates

# Next 16 requires Node >= 20.9.
if ! command -v node >/dev/null 2>&1 ||
   [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Instaluję Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
command -v pnpm >/dev/null 2>&1 || { log "Instaluję pnpm"; npm i -g pnpm; }

# A 1 GB droplet runs out of memory during `next build` without swap.
mem_mb=$(free -m | awk '/^Mem:/{print $2}')
swap_mb=$(free -m | awk '/^Swap:/{print $2}')
if [ "$mem_mb" -lt 2000 ] && [ "$swap_mb" -lt 1000 ]; then
  log "Mało RAM (${mem_mb} MB) — dodaję 2 GB swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Kod aplikacji"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi

log "Usługa systemd"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__PORT__|$PORT|g" \
  "$APP_DIR/deploy/rezervio.service" > /etc/systemd/system/rezervio.service
systemctl daemon-reload
systemctl enable rezervio >/dev/null

log "Nginx (domena: $DOMAIN)"
if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
else
  SERVER_NAME="$DOMAIN www.$DOMAIN"
fi
sed -e "s|__SERVER_NAME__|$SERVER_NAME|g" -e "s|__PORT__|$PORT|g" \
  "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/rezervio
ln -sf /etc/nginx/sites-available/rezervio /etc/nginx/sites-enabled/rezervio
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "Firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

log "Build i start aplikacji"
bash "$APP_DIR/deploy/deploy.sh" --no-pull

ip=$(curl -fsS -4 https://icanhazip.com 2>/dev/null || echo "")

# HTTPS only makes sense once the A record already points here — otherwise
# certbot fails the challenge and would abort an otherwise finished deploy.
if [ "$DOMAIN" != "_" ]; then
  log "HTTPS dla $DOMAIN"
  domain_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)

  if [ -z "$domain_ip" ]; then
    echo "Domena $DOMAIN jeszcze się nie rozwiązuje — pomijam certyfikat."
    echo "Po ustawieniu rekordów A uruchom: bash $APP_DIR/deploy/tls.sh"
  elif [ -n "$ip" ] && [ "$domain_ip" != "$ip" ]; then
    echo "$DOMAIN wskazuje na $domain_ip, a ten droplet ma $ip — pomijam certyfikat."
    echo "Popraw rekord A, potem uruchom: bash $APP_DIR/deploy/tls.sh"
  else
    bash "$APP_DIR/deploy/tls.sh" || echo "Certyfikat się nie udał — aplikacja działa po HTTP."
  fi
fi

log "Gotowe: http://${ip:-IP_DROPLETA}"
[ "$DOMAIN" != "_" ] && echo "Docelowo: https://$DOMAIN"
