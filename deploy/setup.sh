#!/usr/bin/env bash
# Rezervio — one-time host bootstrap for the production droplet.
#
# Run once, as root, on a fresh Ubuntu droplet:
#
#   scp -r deploy root@<droplet>:/tmp/rezervio-deploy
#   ssh root@<droplet> 'bash /tmp/rezervio-deploy/setup.sh'
#
# This prepares the host and nothing else. It does not clone the repo, does
# not install Node, and does not build the application: images are built in
# GitHub Actions and pulled by tag. A 2 GB droplet cannot run `next build`
# and PostgreSQL at the same time, and a box that can build is a box that
# needs a toolchain, a source tree and a second definition of "the release".
#
# What it does install: Podman (rootless), a Compose provider, nginx, and a
# dedicated unprivileged user whose systemd session brings the whole stack
# back after a reboot.
set -euo pipefail

DOMAIN="${DOMAIN:-rezervio.pl}"
APP_USER="${APP_USER:-rezervio}"
APP_DIR="${APP_DIR:-/opt/rezervio}"
WEB_HOST_PORT="${WEB_HOST_PORT:-3000}"
API_HOST_PORT="${API_HOST_PORT:-3001}"
# Where Property photos live: "external" (DigitalOcean Spaces or any other
# S3-compatible service) or "minio" (on this droplet — see DEPLOY.md).
STORAGE="${STORAGE:-external}"
STORAGE_BUCKET="${STORAGE_BUCKET:-rezervio-photos}"
STORAGE_HOST_PORT="${STORAGE_HOST_PORT:-9000}"
# Optional: EMAIL=you@example.com obtains the certificate without prompts.
EMAIL="${EMAIL:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m    %s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root."; exit 1; }

# ------------------------------------------------------------------ packages
log "Pakiety systemowe"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  podman podman-compose \
  uidmap slirp4netns fuse-overlayfs \
  nginx curl ca-certificates rclone jq acl

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman nie zainstalował się — przerwij i sprawdź źródła apt." >&2
  exit 1
fi

# `podman compose` delegates to an external provider. Without one, every later
# command in deploy.sh fails with a message that does not name the cause.
if ! command -v podman-compose >/dev/null 2>&1 && ! podman compose version >/dev/null 2>&1; then
  echo "Brak providera Compose (podman-compose). Zainstaluj go przed wdrożeniem." >&2
  exit 1
fi

# ------------------------------------------------------------------ swap
# `next build` no longer runs here, but PostgreSQL, Redis and three Node
# processes on 2 GB still appreciate somewhere to page to. Kept from the
# previous setup rather than removed.
mem_mb=$(free -m | awk '/^Mem:/{print $2}')
swap_mb=$(free -m | awk '/^Swap:/{print $2}')
if [ "$mem_mb" -lt 4000 ] && [ "$swap_mb" -lt 1000 ]; then
  log "Mało RAM (${mem_mb} MB) — dodaję 2 GB swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer reclaiming page cache over swapping a live Node heap.
  sysctl -qw vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# ------------------------------------------------------------------ user
log "Użytkownik $APP_USER (rootless Podman)"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  # A real login shell and a home directory: `systemd --user` needs both, and
  # that session is what restarts the stack after a reboot.
  useradd --create-home --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
else
  warn "Użytkownik już istnieje — zostawiam bez zmian."
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_DIR/backups"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$APP_DIR/.ssh"

# Rootless Podman maps container users into this range. useradd normally
# assigns it; an account created some other way may not have one.
if ! grep -q "^${APP_USER}:" /etc/subuid; then
  log "Zakresy subuid/subgid"
  usermod --add-subuids 200000-265535 --add-subgids 200000-265535 "$APP_USER"
fi

# Without lingering, the user's systemd session dies at logout and takes the
# containers with it — and never starts at boot. This single line is what
# makes the stack survive a reboot.
log "Lingering (auto-start po reboocie)"
loginctl enable-linger "$APP_USER"

# Lingering brings up the user's systemd session, and with it /run/user/<uid>.
# `systemctl --user` below has nothing to talk to until that exists.
APP_UID="$(id -u "$APP_USER")"
for _ in $(seq 1 30); do
  [ -d "/run/user/$APP_UID" ] && break
  sleep 1
done
[ -d "/run/user/$APP_UID" ] \
  || { echo "Sesja systemd użytkownika $APP_USER nie wstała (/run/user/$APP_UID)." >&2; exit 1; }

# ------------------------------------------------------------------ logs
# Podman hands container output to the journal. Uncapped, that is the one
# thing on this box that grows without limit; 500 MB is plenty for the
# retention an operator actually reads.
log "Limit dziennika systemd"
install -d -m 755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/rezervio.conf <<'JOURNAL'
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxRetentionSec=2week
JOURNAL
systemctl restart systemd-journald

# ------------------------------------------------------------------ systemd
log "Usługa stacku (systemd --user)"
# Every level, not just the leaf: `install -d` sets ownership on the last
# component only, and a root-owned ~/.config makes the user's systemd silently
# find nothing.
units="$APP_DIR/.config/systemd/user"
for dir in "$APP_DIR/.config" "$APP_DIR/.config/systemd" "$units"; do
  install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$dir"
done
for unit in rezervio-stack.service rezervio-backup.service rezervio-backup.timer; do
  install -o "$APP_USER" -g "$APP_USER" -m 644 "$HERE/$unit" "$units/$unit"
done

as_app() { sudo -u "$APP_USER" XDG_RUNTIME_DIR="/run/user/$APP_UID" "$@"; }

# Enabled, not started: there is no release to run yet. The first deploy
# starts it, and every reboot after that does too.
as_app systemctl --user daemon-reload
as_app systemctl --user enable rezervio-stack.service rezervio-backup.timer

# ------------------------------------------------------------------ nginx
log "Nginx (domena: $DOMAIN, storage: $STORAGE)"

# Written either way, so the include in nginx.conf always resolves.
install -d -m 755 /etc/nginx/snippets
if [ "$STORAGE" = "minio" ]; then
  # The bucket is the first path segment and nothing rewrites it: a presigned
  # PUT signs the host and the full path, so the bytes MinIO verifies must be
  # the bytes the browser sent. Strip or rename anything here and every upload
  # fails with SignatureDoesNotMatch.
  cat > /etc/nginx/snippets/rezervio-storage.conf <<STORAGECONF
location /$STORAGE_BUCKET/ {
    proxy_pass http://127.0.0.1:$STORAGE_HOST_PORT;
    proxy_http_version 1.1;
    # Must be the address the URL was signed for.
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # Photos, not JSON. Streamed rather than buffered to disk first.
    client_max_body_size 25m;
    proxy_request_buffering off;
    proxy_read_timeout 120s;

    # Object keys carry a UUID, so a stored photo never changes under its key.
    add_header Cache-Control "public, max-age=31536000, immutable";
}
STORAGECONF
else
  echo "# Storage jest zewnętrzny (Spaces) — nic tu nie proxujemy." \
    > /etc/nginx/snippets/rezervio-storage.conf
fi

if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
else
  SERVER_NAME="$DOMAIN www.$DOMAIN"
fi
sed -e "s|__SERVER_NAME__|$SERVER_NAME|g" \
    -e "s|__WEB_PORT__|$WEB_HOST_PORT|g" \
    -e "s|__API_PORT__|$API_HOST_PORT|g" \
  "$HERE/nginx.conf" > /etc/nginx/sites-available/rezervio
ln -sf /etc/nginx/sites-available/rezervio /etc/nginx/sites-enabled/rezervio
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ------------------------------------------------------------------ firewall
log "Firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------ TLS
if [ "$DOMAIN" != "_" ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  log "HTTPS dla $DOMAIN"
  ip=$(curl -fsS -4 https://icanhazip.com 2>/dev/null || echo "")
  domain_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)

  if [ -z "$domain_ip" ]; then
    warn "Domena $DOMAIN jeszcze się nie rozwiązuje — pomijam certyfikat."
    warn "Po ustawieniu rekordów A: bash $HERE/tls.sh"
  elif [ -n "$ip" ] && [ "$domain_ip" != "$ip" ]; then
    warn "$DOMAIN wskazuje na $domain_ip, a ten droplet ma $ip — pomijam certyfikat."
  else
    EMAIL="$EMAIL" bash "$HERE/tls.sh" || warn "Certyfikat się nie udał — dokończ przez tls.sh."
  fi
else
  warn "Certyfikat już istnieje albo domena to '_' — pomijam tls.sh."
fi

# ------------------------------------------------------------------ done
cat <<DONE

$(printf "\033[1;32m==> Host gotowy.\033[0m")

Czego jeszcze brakuje, zanim pierwszy deploy przejdzie:

  1. $APP_DIR/.env.production   (0600, własność $APP_USER)
     Wzór: deploy/env.production.example — przenieś go i uzupełnij sekrety.

  2. Klucz publiczny SSH dla użytkownika $APP_USER:
       $APP_DIR/.ssh/authorized_keys   (0600)
     Ten klucz trafia do sekretu PROD_SSH_PRIVATE_KEY w GitHubie.

  3. Logowanie do GHCR, jeśli obrazy są prywatne:
       sudo -u $APP_USER podman login ghcr.io

Potem: GitHub → Actions → Deploy Production → git_ref.
Stara usługa rezervio.service (jeśli działa) zostaje nietknięta do cutoveru —
procedura w DEPLOY.md, sekcja "Pierwszy cutover".
DONE
