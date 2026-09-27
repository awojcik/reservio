# Milestone 13 — Production MVP & Operations

## Goal

Uruchomić aktualne Rezervio jako utrzymywalną aplikację produkcyjną na obecnym DigitalOcean Droplecie, bez dokładania kosztownej infrastruktury i bez over-engineeringu.

Milestone ma zapewnić:
- powtarzalny CI/CD;
- deployment wybranego Git ref/brancha;
- obrazy OCI w GHCR;
- uruchomienie całego stacku przez Podman Compose;
- bezpieczne przejście ze starego frontend-only deploymentu;
- PostgreSQL + Redis + API + worker + web;
- nginx + istniejące TLS/Certbot;
- health checks;
- podstawowe logi i metryki;
- backup/restore PostgreSQL;
- prosty rollback;
- aktualny `DEPLOY.md` jako production runbook.

Stripe pozostaje w **TEST/SANDBOX MODE**. Włączenie realnych płatności jest osobnym milestone'em.

## 0. Aktualny stan

Droplet:
- Ubuntu
- 1 vCPU
- 2 GB RAM
- 70 GB disk
- FRA1

Aktualna publiczna wersja:

```text
Internet
  ↓
nginx :80/:443
  ↓
127.0.0.1:3000
  ↓
systemd: rezervio.service
  ↓
node .next/standalone/server.js
```

Aktualny service:

```ini
User=root
WorkingDirectory=/root/reservio
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
```

Repo zawiera:
- `DEPLOY.md`
- `deploy/setup.sh`
- `deploy/deploy.sh`
- `deploy/tls.sh`
- `deploy/rezervio.service`
- `deploy/nginx.conf`

Te pliki należy **zaktualizować**, a nie tworzyć obok nich drugi niezależny system deploymentu.

## 1. Docelowa architektura

```text
GitHub
  ↓
GitHub Actions
  ├── lint
  ├── typecheck
  ├── tests
  └── build
  ↓
GHCR
  ├── rezervio-web:<git-sha>
  ├── rezervio-api:<git-sha>
  └── opcjonalnie custom postgres image
  ↓
manual Deploy Production
  ↓ SSH
DigitalOcean Droplet
  ↓
Podman Compose
  ├── web
  ├── api
  ├── worker
  ├── postgres
  └── redis
  ↓
nginx
  ↓
https://rezervio.pl
```

Nie wprowadzamy na tym etapie:
- Kubernetes
- ArgoCD
- Jenkins
- self-hosted GitHub runner
- Prometheus/Grafana/Loki/ELK
- Vault

## 2. CI — GitHub Actions

Dodać `.github/workflows/ci.yml`.

Trigger:
- `pull_request`
- `push`

CI wykonuje odpowiednie dla repo:
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Jeśli testy integracyjne wymagają PostgreSQL/Redis, uruchomić je w CI.

CI nie posiada produkcyjnych sekretów.

## 3. Build & publish OCI images

Publikować do GHCR:
```text
ghcr.io/awojcik/rezervio-web:<git-sha>
ghcr.io/awojcik/rezervio-api:<git-sha>
```

Worker ma używać tego samego image co API, jeśli aktualny kod to umożliwia.

Sprawdzić `containers/postgres` i realne wymagania migracji/extensionów. Jeśli potrzebny jest custom image PostgreSQL, wersjonować go również w GHCR.

Nie polegać wyłącznie na `latest`.

## 4. CD — manualny deployment

Dodać `.github/workflows/deploy-production.yml`.

Na start:
```text
workflow_dispatch
```

Input:
```text
git_ref
```

Możliwe wartości:
- branch
- `master`
- konkretny commit SHA

Workflow ma resolve `git_ref` do immutable SHA i wdrożyć właśnie ten SHA.

Dodać `concurrency: production`, aby dwa deploymenty nie wykonywały się równocześnie.

Na początku **bez auto-deploy po merge do master**.

## 5. GitHub secrets

GitHub powinien znać tylko sekrety deploymentowe, np.:
- `PROD_HOST`
- `PROD_USER`
- `PROD_SSH_PRIVATE_KEY`

Jeśli prywatne obrazy GHCR wymagają tokenu do pull, użyć tokenu read-only.

Sekrety aplikacji pozostają na Droplecie.

## 6. Production host

Docelowy katalog:
```text
/opt/rezervio
```

Aplikacja nie powinna docelowo działać jako root.

Utworzyć dedykowanego użytkownika, np. `rezervio` lub `deploy`.

Preferować rootless Podman, jeśli nie komplikuje to niezawodnego startu po reboot.

Wymaganie:
> po restarcie Dropleta cały stack uruchamia się automatycznie.

## 7. Production Compose

Dodać:
```text
deploy/compose.prod.yml
```

Usługi:
```text
web
api
worker
postgres
redis
```

### web
- production image;
- host bind tylko do loopback;
- health check;
- nginx pozostaje publicznym entrypointem.

### api
- production image;
- loopback/private network;
- health/readiness;
- DB + Redis.

### worker
- bez publicznego portu;
- reuse API image, jeśli możliwe;
- ostrożne concurrency pod 1 vCPU / 2 GB RAM.

### postgres
- persistent volume;
- wymagane extensions;
- brak publicznego portu.

### redis
- private network;
- persistent volume, jeśli odpowiada obecnemu BullMQ setup;
- nie jest source of truth.

## 8. Nginx / domena / TLS

Zachować:
- nginx
- `rezervio.pl`
- `www.rezervio.pl`
- Let's Encrypt / Certbot

Nie migrować do Caddy.

Sprawdzić API client, auth cookies i CORS i wybrać najmniejszą zmianę:

wariant A:
```text
rezervio.pl      → web :3000
rezervio.pl/api/ → api :3001
```

albo wariant B:
```text
rezervio.pl      → web :3000
api.rezervio.pl  → api :3001
```

Nie zgadywać — dobrać do realnego kodu.

## 9. Production env / secrets

Na Droplecie:
```text
/opt/rezervio/.env.production
```

Permissions:
```text
600
```

Typowe wartości:
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- Stripe test keys
- webhook secret
- encryption keys
- mail credentials
- object storage credentials
- Hostaway/Channex credentials, jeśli używane

Stripe w tym milestone:
```text
TEST MODE ONLY
```

Nie commitować `.env.production`.
Nie logować sekretów.

## 10. Database migrations

Deployment ma mieć jawny krok migracji.

Schemat:
```text
pull images
↓
run DB migrations
↓
start/upgrade services
↓
health check
```

Nie uruchamiać migracji równolegle.

Przyjąć policy:
> migracje produkcyjne powinny być backward-compatible z poprzednim release'em.

Destrukcyjne zmiany schema wykonywać expand/contract.

## 11. Pierwszy cutover ze starego deploymentu

Przed zmianą:
- commit brancha jest w GitHub;
- CI green;
- images istnieją;
- `.env.production` gotowy;
- Postgres/Redis gotowe;
- migracje gotowe;
- nginx config przygotowany;
- health endpoints gotowe.

Pierwszy cutover:
```text
1. przygotuj /opt/rezervio
2. pull images
3. uruchom postgres + redis
4. uruchom migracje
5. uruchom api + worker
6. zweryfikuj API lokalnie
7. systemctl stop rezervio.service
8. systemctl disable rezervio.service
9. uruchom nowy web
10. reload nginx jeśli potrzebne
11. smoke tests
```

Po sukcesie można usunąć stary `rezervio.service`.

Kod `/root/reservio` nie jest już runtime dependency po przejściu na image-based deployment.

## 12. Health & readiness

Reuse istniejące health endpoints, jeśli istnieją.

Minimum:
```text
GET /            → web odpowiada
GET /api/health  → API alive
readiness        → DB/Redis ready, jeśli endpoint istnieje
```

Deployment kończy się sukcesem dopiero po przejściu health checks.

## 13. Rollback

Rollback aplikacji:
```text
Deploy Production
git_ref = poprzedni commit SHA
```

Potem:
```text
podman compose pull
podman compose up -d
health check
```

W `DEPLOY.md` jasno zaznaczyć:
> rollback image nie cofa automatycznie niekompatybilnej migracji DB.

## 14. Logi

Nie instalować ELK/Loki/Grafany.

Aplikacje logują strukturalnie do stdout/stderr.

Zapewnić:
- `podman compose logs`;
- log rotation / ograniczenie wzrostu logów;
- przykłady komend w `DEPLOY.md`.

Nie logować:
- haseł;
- cookies/session tokens;
- Stripe secrets;
- card data;
- API keys;
- PMS credentials;
- sensitive access codes.

## 15. Podstawowe metryki i alerty

Na start użyć lekkich mechanizmów:
- DigitalOcean host metrics
- CPU
- RAM
- disk
- load

Ustawić lub opisać alerty:
- CPU high
- RAM high
- disk > ~80%
- Droplet unavailable

Dodać zewnętrzny uptime check dla:
```text
https://rezervio.pl/
https://rezervio.pl/api/health
```

Jeśli wymaga zewnętrznego konta, oznaczyć jako manual/external prerequisite.

## 16. Backup PostgreSQL

Minimum:
```text
daily pg_dump
compression
off-host copy
retention
restore procedure
```

Preferowana retencja MVP:
```text
daily: 7
weekly: 4
monthly: 3
```

Backup nie może istnieć wyłącznie na tym samym Droplecie.

Dodać np.:
```text
deploy/backup.sh
```

Target: S3-compatible storage.

Jeśli brak credentials:
- przygotować implementację;
- oznaczyć BLOCKED/EXTERNAL;
- nie raportować backupu jako PASS.

Przygotować restore verification procedure.

## 17. Object storage

Sprawdzić aktualny sposób obsługi zdjęć.

Nie pozwolić, aby produkcyjne zdjęcia trafiały wyłącznie na ephemeral container filesystem.

Reuse istniejącą abstrakcję S3-compatible storage.

Jeśli zostaje lokalny MinIO:
- persistence musi być jawne;
- backup musi obejmować te dane;
- ryzyko ma być udokumentowane.

## 18. `DEPLOY.md` — obowiązkowa aktualizacja

`DEPLOY.md` ma stać się aktualnym production runbookiem.

Usunąć/zmienić stare twierdzenia typu:
```text
Aplikacja nie ma bazy danych, sekretów ani zmiennych środowiskowych
```

oraz stary model:
```text
git pull
pnpm install
pnpm build na Droplecie
systemd Next.js service
```

Nowy dokument ma opisywać:
- architecture
- first-time server setup
- GitHub Actions CI
- GHCR
- manual production deployment
- deploy from selected Git ref
- server `.env.production`
- Podman Compose
- PostgreSQL
- Redis
- migrations
- nginx
- TLS renewal
- health checks
- logs
- backup
- restore
- rollback
- troubleshooting

Nie mieszać aktualnego runbooka z instrukcjami Milestone 01.

## 19. `deploy/` — refactor

Przeanalizować:
- `deploy/setup.sh`
- `deploy/deploy.sh`
- `deploy/tls.sh`
- `deploy/rezervio.service`
- `deploy/nginx.conf`

Docelowo np.:
```text
deploy/
├── setup.sh
├── deploy.sh
├── backup.sh
├── compose.prod.yml
├── nginx.conf
└── tls.sh
```

Opcjonalnie:
```text
rollback.sh
```

`setup.sh`:
- instaluje/przygotowuje Podman;
- deploy user;
- `/opt/rezervio`;
- nginx;
- firewall;
- permissions;
- reboot-safe startup;
- nie buduje Next/Nest.

`deploy.sh`:
- przyjmuje release SHA;
- pull images;
- migration;
- compose up;
- health check.

`rezervio.service` jest legacy i można go usunąć dopiero po udanym cutover.

## 20. Resource constraints

Droplet:
```text
1 vCPU
2 GB RAM
70 GB disk
```

Dlatego:
- żadnego builda Next/Nest na produkcji;
- bez ciężkiego monitoringu;
- ograniczyć worker concurrency;
- rozsądnie ustawić Postgres/Redis;
- istniejący swap może zostać jako safety net;
- log rotation;
- monitorować disk usage;
- nie uruchamiać zbędnych usług.

## 21. Production payments

Po tym milestone infrastruktura może być produkcyjna, ale:
```text
Stripe = TEST MODE
```

Nie przełączać:
- live secret key;
- live publishable key;
- live webhook;
- real Connect payouts.

## 22. Smoke test po pierwszym wdrożeniu

Minimum:
- Home
- Search
- Property detail
- Host login
- Host property list/edit
- availability API
- create booking
- Stripe sandbox checkout
- webhook
- Booking confirmation
- My Trips
- worker jobs
- admin page
- restart stack
- full Droplet reboot → stack returns automatically

## 23. Definition of Done

Milestone jest ukończony, gdy:
- CI działa;
- manual CD działa;
- można deployować wybrany branch/ref;
- images są tagowane SHA;
- Droplet nie buduje aplikacji;
- web działa przez nginx;
- API działa;
- worker działa;
- PostgreSQL persistent;
- Redis działa;
- migracje są częścią deploymentu;
- health checks są częścią deploymentu;
- reboot Dropleta odtwarza cały stack;
- stary frontend-only `rezervio.service` jest wycofany;
- logi są dostępne i rotowane;
- podstawowe host metrics/alerts są skonfigurowane lub jasno opisane jako external step;
- backup PostgreSQL jest automatyczny;
- off-host backup został zweryfikowany albo jawnie oznaczony jako zablokowany brakiem credentials;
- restore procedure została sprawdzona lub nie raportowano PASS;
- rollback do poprzedniego SHA jest opisany i sprawdzony;
- `DEPLOY.md` opisuje aktualny stan;
- `deploy/` nie zawiera aktywnych sprzecznych instrukcji;
- Stripe nadal TEST MODE;
- lint/typecheck/tests/build green.

## 24. Out of scope

Nie implementować:
- Stripe live payments;
- Confirmed Booking cancellation/refund policy;
- Kubernetes;
- autoscaling;
- multi-region;
- HA PostgreSQL;
- managed Redis;
- Prometheus/Grafana/Loki;
- tracing platform;
- blue/green deployment platform;
- hotel inventory model;
- nowych funkcji produktu.

## 25. Następne milestone'y

```text
M14 — Production Payments Enablement
M15 — Confirmed Booking Cancellation & Refund Policy
M16 — Reviews & Post-Stay
M17 — AI Search & AI Host Tools
```
