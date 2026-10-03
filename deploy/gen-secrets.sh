#!/usr/bin/env bash
# Rezervio — wygeneruj sekrety produkcyjne.
#
#   bash deploy/gen-secrets.sh
#
# Uruchom LOKALNIE, wklej wynik do /opt/rezervio/.env.production i zamknij
# terminal. Nic tu nie jest zapisywane na dysk i nic nie trafia do gita.
#
# Trzy klucze szyfrujące są osobne celowo: adresy iCal, kody do drzwi i dane
# dostępowe dostawców dają się wtedy rotować niezależnie od siebie. Jeden
# klucz w trzech miejscach oznacza, że rotacja jednego psuje pozostałe dwa.
set -euo pipefail
b64() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
hex() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }

PG_PASS=$(hex 24)      # hex, bo to hasło wchodzi do URL-a: żadnego @ : / ? #
S3_SECRET=$(hex 24)

cat <<OUT
POSTGRES_PASSWORD=$PG_PASS
DATABASE_URL=postgresql://rezervio:$PG_PASS@postgres:5432/rezervio

S3_ACCESS_KEY_ID=rezerviostorage
S3_SECRET_ACCESS_KEY=$S3_SECRET

ICAL_URL_ENCRYPTION_KEY=$(b64)
STAY_SENSITIVE_DATA_ENCRYPTION_KEY=$(b64)
PROVIDER_CREDENTIALS_ENCRYPTION_KEY=$(b64)
OUT
