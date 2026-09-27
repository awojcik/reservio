# Rezervio — produkcja

Runbook jednego dropleta. Wszystko, co tu jest, dotyczy wdrożenia pod
`rezervio.pl`; nic tu nie buduje się na serwerze.

> **Stripe pozostaje w trybie TEST/SANDBOX.** Klucz `sk_live_…` / `rk_live_…`
> zatrzymuje start procesu — w każdym środowisku, produkcji nie wyłączając.
> Przejście na żywe płatności to osobna, świadoma decyzja, nie zmiana zmiennej.

---

## Architektura wdrożenia

```text
GitHub
  └─ push ─────────▶ CI: lint · typecheck · test · build
                         └─ master ─▶ obrazy → GHCR (tag = git SHA)

  └─ Actions ──────▶ Deploy Production (ręcznie, git_ref)
                         ├─ resolve ref → niezmienny SHA
                         ├─ obrazy dla tego SHA → GHCR
                         └─ SSH ─▶ droplet
```

Na droplecie:

```text
Internet ──▶ nginx (host, :80/:443, Let's Encrypt)
               ├──▶ 127.0.0.1:3000   web      Next.js standalone
               └──▶ 127.0.0.1:3001   api      NestJS (/api/…)

             podman compose (rootless, użytkownik `rezervio`)
               web ─┐
               api ─┼──▶ postgres   PostGIS · pg_trgm · pgvector  (bez portu)
               worker ─┴──▶ redis   BullMQ                        (bez portu)
```

Pięć kontenerów, jeden obraz na `api` i `worker` — ten sam kod, inna komenda
(`node dist/main.js` kontra `node dist/worker.js`). Kolejki konsumuje wyłącznie
worker; API je tylko produkuje. Dzięki temu synchronizacja kalendarza nie
konkuruje o event loop z żądaniem gościa, a restart API nie zwielokrotnia
cyklicznych sweepów.

**Jedno origin, nie dwa.** `rezervio.pl/api/` zamiast `api.rezervio.pl`:
sesja to `HttpOnly` cookie z `SameSite=Lax`, API odrzuca cross-site zapisy po
`Origin`, a `NEXT_PUBLIC_API_URL` jest **wkompilowany** w bundle przeglądarki.
Ten sam origin oznacza brak preflightu na gorącej ścieżce, jeden certyfikat
i żadnego wyjątku na domenę cookie.

### Czego tu nie ma i dlaczego

```text
build na serwerze        1 vCPU / 2 GB nie zbuduje Next.js obok PostgreSQL-a
Kubernetes               jeden droplet
Prometheus / Grafana     metryki hosta daje DigitalOcean, za darmo i bez RAM-u
Loki / ELK               logi idą do journald, z limitem
MinIO                    zdjęcia trzyma zewnętrzny S3 (Spaces) — patrz §Storage
```

---

## Wymagania zewnętrzne

Bez tych rzeczy wdrożenie **nie jest kompletne**. Każda wymaga konta lub
dostępu, którego repozytorium nie ma.

| Co | Po co | Bez tego |
| --- | --- | --- |
| DNS `A rezervio.pl` → droplet | TLS i ruch | certbot nie wystawi certyfikatu |
| Object storage: Spaces **albo** MinIO na droplecie | zdjęcia obiektów | **API nie wstanie** — `S3_*` są wymagane w produkcji; warianty w §Storage |
| Bucket na backupy (osobny) | kopia poza hostem | `backup.sh` kończy się błędem, i tak ma być |
| Konto SMTP | powiadomienia | maile lądują jako `FAILED`; reszta działa |
| Sekrety GitHuba: `PROD_HOST`, `PROD_USER`, `PROD_SSH_PRIVATE_KEY` | CD | workflow zatrzyma się na pierwszym kroku |
| Stripe sandbox: `sk_test_…`, `whsec_…`, `pk_test_…` | płatności | rezerwacje nie przejdą w `CONFIRMED` |
| Uptime check (zewnętrzny) | wiedza, że leży | nikt się nie dowie |

Zalecane, opcjonalne: sekret `PROD_SSH_HOST_KEY` (przypięty klucz hosta) oraz
zmienne repozytorium `NEXT_PUBLIC_API_URL`, `S3_PUBLIC_BASE_URL`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PUBLIC_BASE_URL`.

---

## Pierwsza konfiguracja hosta

Raz, jako root, na świeżym droplecie.

```bash
scp -r deploy root@<droplet>:/tmp/rezervio-deploy
ssh root@<droplet> 'EMAIL=ty@example.com bash /tmp/rezervio-deploy/setup.sh'
```

`setup.sh` jest idempotentny i **nie buduje aplikacji**. Instaluje Podmana,
providera Compose, nginx, rclone i certbota; zakłada użytkownika `rezervio`
z lingerem; ogranicza dziennik; wystawia certyfikat, jeśli DNS już wskazuje
tutaj.

Wdrożenia kopiują na droplet tylko `compose.prod.yml`, `deploy.sh`,
`rollback.sh` i `backup.sh`. Pliki systemd i konfiguracja nginxa instalują się
wyłącznie tutaj — po ich zmianie w repo uruchom `setup.sh` ponownie.

Potem trzy rzeczy, których skrypt zrobić za nikogo nie może:

```bash
# 1. Konfiguracja aplikacji — wzór jest w repo.
scp deploy/env.production.example root@<droplet>:/tmp/
ssh root@<droplet> '
  install -m 600 -o rezervio -g rezervio /tmp/env.production.example \
    /opt/rezervio/.env.production'
ssh root@<droplet> 'sudoedit -u rezervio /opt/rezervio/.env.production'   # uzupełnij ZMIEŃ

# 2. Klucz SSH dla deploya (ten, którego para trafi do PROD_SSH_PRIVATE_KEY).
ssh root@<droplet> '
  install -m 600 -o rezervio -g rezervio /dev/stdin /opt/rezervio/.ssh/authorized_keys' \
  < ~/.ssh/rezervio_deploy.pub

# 3. Logowanie do GHCR, jeśli pakiety są prywatne.
ssh root@<droplet> 'sudo -u rezervio podman login ghcr.io'
```

Logowanie zapisuje się w `~rezervio/.config/containers/auth.json` i przeżywa
reboot, więc robi się je raz. Jako hasła użyj **read-only** PAT-a z zakresem
`read:packages` — droplet ma obrazy pobierać, nie publikować.

Klucz hosta do przypięcia w GitHubie:

```bash
ssh-keyscan -H <droplet> 2>/dev/null     # → sekret PROD_SSH_HOST_KEY
```

---

## CI

`.github/workflows/ci.yml`, na każdy push i pull request.

```text
quality        pnpm install --frozen-lockfile
               pnpm lint
               pnpm typecheck
               pnpm db:migrate          (na świeżej bazie)
               pnpm test
               pnpm build

deploy-files   bash -n deploy/*.sh
               shellcheck deploy/*.sh
               podman-compose config    (compose.prod.yml się rozwiązuje)
               nginx -t                 (nginx.conf jest poprawny)

images         tylko master → .github/workflows/images.yml
```

PostgreSQL nie jest zwykłym `services:`: testy integracyjne potrzebują PostGIS,
pg_trgm i pgvectora **naraz**, a żaden publikowany obraz nie ma całej trójki.
CI buduje więc ten sam obraz, który wdraża — co przy okazji sprawdza, że
`containers/postgres/Containerfile` nadal się buduje.

W CI nie ma żadnego produkcyjnego sekretu. Stripe nie jest wołany: testy
podstawiają atrapę pod interfejs `PaymentProvider`.

---

## Obrazy i GHCR

`.github/workflows/images.yml` — wywoływany przez CI (na master) i przez deploy
(dla dowolnego wskazanego ref-a).

```text
ghcr.io/<owner>/rezervio/api:<git-sha>
ghcr.io/<owner>/rezervio/web:<git-sha>
ghcr.io/<owner>/rezervio/postgres:<git-sha>
```

Tagiem wydania jest **pełny SHA commita**. `latest` jest publikowany z mastera,
ale nic po nim nie wdraża: tag, który się przesuwa, to tag, do którego nie da
się wrócić.

`web` dostaje trzy build-argumenty, bo Next wkompilowuje je w bundle i w CSP:

```text
NEXT_PUBLIC_API_URL                https://rezervio.pl/api
S3_PUBLIC_BASE_URL                 publiczny adres bucketa ze zdjęciami
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY pk_test_…
```

Zmiana któregokolwiek z nich to **przebudowa obrazu**, nie restart kontenera.

---

## Wdrożenie wybranego ref-a

```text
GitHub → Actions → Deploy Production → Run workflow
  git_ref          master | nazwa-brancha | v0.3.0 | a1b2c3d…
  skip_migrations  false (true tylko przy cofaniu)
```

Ref jest rozwiązywany do niezmiennego SHA **zanim** cokolwiek się zbuduje, więc
„wdróż master" znaczy master z tamtej minuty, a nie z chwili, gdy job dobił do
dropleta. `concurrency: deploy-production` nie przepuszcza dwóch wdrożeń naraz
i ich nie anuluje — przerwana w połowie migracja jest gorsza od czekania.

Co dzieje się na droplecie (`deploy/deploy.sh`):

```text
1. pull trzech obrazów po SHA        brak tagu = błąd, stare wydanie dalej działa
2. zapis .env z numerem wydania
3. up postgres + redis, czekanie na pg_isready
4. migracje pod flockiem             nigdy równolegle
5. up api + worker + web
6. health checks                     /api/health, /api/ready, web /, worker up
```

Porażka na dowolnym kroku: ostatnie logi na wyjściu, `exit 1`, workflow na
czerwono. Nie ma „wdrożone z ostrzeżeniami".

Ręcznie, z dropleta, to samo:

```bash
sudo -u rezervio bash -c 'cd /opt/rezervio && RELEASE_SHA=<sha> ./deploy.sh'
```

---

## Konfiguracja produkcyjna

```text
/opt/rezervio/
├── compose.prod.yml      kopiowany przez workflow razem z wydaniem
├── deploy.sh             ↑ to samo
├── rollback.sh
├── backup.sh
├── .env                  wersja wydania i parametry compose (pisze deploy.sh)
├── .env.production       0600 — sekrety aplikacji, NIGDY w gicie
├── releases.log          co, kiedy, po czym
└── backups/              lokalne kopie pg_dump
```

Wzór: [`deploy/env.production.example`](deploy/env.production.example).

GitHub trzyma **wyłącznie** sekrety potrzebne, żeby dosięgnąć dropleta
(`PROD_HOST`, `PROD_USER`, `PROD_SSH_PRIVATE_KEY`, opcjonalnie
`PROD_SSH_HOST_KEY`). Sekrety aplikacji nie opuszczają serwera — nie ma powodu,
żeby klucz szyfrujący kody do drzwi przechodził przez cudzy runner.

API waliduje konfigurację przy starcie. Brak `DATABASE_URL`, `WEB_ORIGIN`,
`APP_BASE_URL`, `ICAL_URL_ENCRYPTION_KEY` albo któregokolwiek `S3_*` zatrzymuje
proces. To celowe: brakujący sekret znaleziony przez pierwsze żądanie, które go
potrzebuje, to incydent; ten sam sekret znaleziony przy starcie to nieudany
deploy.

---

## Podman Compose — codzienne komendy

Wszystko jako użytkownik `rezervio`:

```bash
sudo -iu rezervio
cd /opt/rezervio

podman compose -f compose.prod.yml ps
podman compose -f compose.prod.yml logs -f api
podman compose -f compose.prod.yml logs --tail 200 worker
podman compose -f compose.prod.yml restart api

systemctl --user status rezervio-stack
systemctl --user restart rezervio-stack
```

### Start po reboocie

Bez żadnej ręcznej akcji. `loginctl enable-linger rezervio` sprawia, że sesja
systemd tego użytkownika wstaje przy starcie systemu, a nie przy pierwszym
logowaniu; `rezervio-stack.service` robi wtedy `podman compose up -d` na tym
wydaniu, które ostatnio zapisał `deploy.sh`.

```bash
systemctl --user is-enabled rezervio-stack     # enabled
loginctl show-user rezervio | grep Linger      # Linger=yes
```

---

## PostgreSQL

Obraz z repo (`containers/postgres`): PostGIS, pg_trgm i pgvector w jednym.
Żaden publikowany tag nie ma wszystkich trzech, a migracje potrzebują każdej.

Dane leżą w wolumenie `rezervio-pgdata` i przeżywają `compose down`. Port nie
jest publikowany — jedyne, co ma tu zaglądać, jest w tej samej sieci, a
`backup.sh` wchodzi przez `podman exec`.

```bash
podman exec -it rezervio-postgres psql -U rezervio -d rezervio
podman exec rezervio-postgres psql -U rezervio -d rezervio -c '\dx'   # rozszerzenia
```

Pierwszy administrator — rola nie pochodzi z API i nie ma endpointu, który by
ją nadał:

```bash
podman compose -f compose.prod.yml run --rm --no-deps api \
  node dist/infrastructure/database/grant-role.js ada@example.com ADMIN
```

## Redis

Kolejki BullMQ i liczniki rate limitu. **Nigdy** źródło prawdy o dostępności —
ta jest wyłącznie w PostgreSQL-u. `appendonly yes`, bo zgubione zadanie to
niewysłany mail albo niewykonany przelew. `maxmemory-policy noeviction`:
kolejka, z której Redis sam wyrzuca zadania, jest gorsza od kolejki, która
odmawia przyjęcia nowych.

## Migracje

Krok jawny w `deploy.sh`, pod `flock` — dwa wdrożenia minutę po sobie nie
wejdą w ten sam schemat równolegle.

> **Migracje produkcyjne mają być zgodne wstecz z poprzednim wydaniem.**
> Dodanie kolumny, którą stary kod ignoruje: w porządku. Usunięcie albo
> przepisanie czegoś, czego stary kod używa: rollback aplikacji przestaje
> działać, a jedynym wyjściem zostaje backup.

Ten milestone nie wprowadza żadnej destrukcyjnej zmiany schematu.

---

## Storage na zdjęcia — dwa warianty

Zdjęcia obiektu **nie przechodzą przez API**. Przeglądarka dostaje presigned
URL i wgrywa plik prosto do storage — dlatego storage musi być publicznie
osiągalny dokładnie pod tym adresem, pod którym URL został podpisany.

### A. DigitalOcean Spaces — zalecany

Bucket public-read w `fra1`, klucz Spaces, pięć zmiennych w `.env.production`
i tyle. Zdjęcia nie leżą na droplecie, więc nie zajmują jego dysku, nie giną
razem z nim i nie wymagają własnego backupu.

### B. MinIO na droplecie

Kiedy nie chcesz jeszcze zakładać Spaces. Wymaga trzech rzeczy:

```bash
# 1. nginx musi wiedzieć, że ma proxować bucket:
STORAGE=minio STORAGE_BUCKET=rezervio-photos bash /tmp/rezervio-deploy/setup.sh

# 2. nakładka compose na droplecie — jej obecność to cały przełącznik:
scp deploy/compose.storage.yml rezervio@<droplet>:/opt/rezervio/

# 3. wariant B w .env.production (patrz env.production.example)
```

Układ adresów jest tu jedyną rzeczą, której nie wolno zmienić:

```text
S3_ENDPOINT          https://rezervio.pl              ← publiczny, nie nazwa kontenera
S3_BUCKET            rezervio-photos                  ← = STORAGE_BUCKET w setup.sh
S3_FORCE_PATH_STYLE  true
S3_PUBLIC_BASE_URL   https://rezervio.pl/rezervio-photos

nginx:  location /rezervio-photos/  →  127.0.0.1:9000   (bez przepisywania ścieżki)
```

Podpis presigned PUT obejmuje **host i pełną ścieżkę**. nginx przekazuje jedno
i drugie bez zmian, więc MinIO liczy ten sam podpis, co AWS SDK w API. Zmień
prefiks, obetnij ścieżkę albo podstaw inny `Host` — i każdy upload kończy się
`SignatureDoesNotMatch`. Przy okazji: to ten sam origin co aplikacja, więc
upload nie jest cross-origin i CORS nie wchodzi w grę.

Bucket i politykę publicznego odczytu zakłada samo API przy starcie; dlatego
`deploy.sh` podnosi MinIO **przed** API.

> **Co kupujesz tą oszczędnością.** Zdjęcia lądują na tym samym dysku i w tym
> samym cyklu życia, co reszta dropleta: utrata maszyny to utrata zdjęć,
> chyba że `backup.sh` zdążył je skopiować poza host. MinIO zjada też ~150–250
> MB RAM-u z dwóch gigabajtów, które dzieli już pięć procesów. `backup.sh`
> kopiuje wolumen `rezervio-photos` przez `rclone copy` (nigdy `sync` —
> synchronizacja skasowałaby kopię dokładnie w dniu, w którym wolumen znika)
> i **kończy się błędem**, gdy `BACKUP_S3_*` nie jest ustawione.

### Przejście B → A później

To zmiana konfiguracji, nie kodu — `ObjectStorage` jest jedną abstrakcją nad
S3, a `Property.coverImage` trzyma `object_key`, nie URL:

```bash
rclone copy :s3:stary… :s3:nowy…      # przenieś pliki
# → wariant A w .env.production, nowy S3_PUBLIC_BASE_URL w GitHub variables
# → przebuduj web (S3_PUBLIC_BASE_URL wchodzi do CSP i next/image)
# → usuń /opt/rezervio/compose.storage.yml i wdroż ponownie
```

---

## Nginx i TLS

Konfiguracja: [`deploy/nginx.conf`](deploy/nginx.conf), instalowana przez
`setup.sh` z podstawieniem `__SERVER_NAME__`, `__WEB_PORT__`, `__API_PORT__`.

`location /api/` przekazuje URI bez zmian (`proxy_pass` bez ukośnika na końcu),
bo API ma globalny prefiks `/api` i przepisanie ścieżki poróżniłoby aplikację
z adresem, którego użyła przeglądarka. `X-Forwarded-Proto` jest obowiązkowy:
z niego API wie, że żądanie przyszło po TLS, i dopiero wtedy ustawia cookie
jako `Secure`.

```bash
nginx -t && systemctl reload nginx
bash /tmp/rezervio-deploy/tls.sh            # certyfikat, jeśli DNS nie był gotowy
certbot renew --dry-run                     # odnowienia pilnuje timer certbota
```

Certbot i jego timer zostają bez zmian od poprzedniego wdrożenia. Nie ma tu
migracji na Caddy'ego.

---

## Health checks

```text
GET /                 web   Next.js odpowiada
GET /api/health       api   sam proces; NIE dotyka bazy ani Redisa
GET /api/ready        api   PostgreSQL + Redis odpowiadają; 503, gdy nie
```

Rozdzielenie jest celowe: gdyby `/health` odpytywał bazę, chwilowa awaria bazy
zamieniłaby się w restart wszystkich instancji naraz.

Worker nie ma endpointu — nikogo nie obsługuje. `deploy.sh` sprawdza, że
kontener działa, i to jest całe twierdzenie.

```bash
curl -s localhost:3001/api/health | jq
curl -s localhost:3001/api/ready  | jq
curl -sI localhost:3000/ | head -1
```

Z zewnątrz: `https://rezervio.pl/`, `https://rezervio.pl/api/health`.

---

## Logi

Aplikacja pisze structured JSON na stdout; Podman oddaje to dziennikowi.

```bash
podman compose -f compose.prod.yml logs -f api
podman compose -f compose.prod.yml logs --tail 200 --timestamps worker
journalctl --user -u rezervio-stack -n 100
journalctl --user CONTAINER_NAME=rezervio-api -f
```

Każda linia niesie `requestId`, więc rezerwację, która poszła źle, da się
przejść przez guard, serwis i wywołanie dostawcy bez zgadywania po znacznikach
czasu.

**Czego w logach nie ma, i nie wskutek przypadku:** `Authorization`, `Cookie`,
`Set-Cookie`, `stripe-signature`, hasła, kody do drzwi, hasła Wi-Fi, klucze
dostawców, token eksportu iCal w ścieżce URL, fraza wyszukiwania (bywa
nazwiskiem albo mailem gościa). Redakcja siedzi w aplikacji, nie w kolektorze —
sekret ma nie powstać w linii logu, a nie zostać z niej później wycięty.

### Rotacja

Dwa poziomy, bo od providera Compose zależy, który zadziała:

* `compose.prod.yml` deklaruje `max-size: 10m`, `max-file: 5` na usługę;
* `setup.sh` ogranicza dziennik systemd do `SystemMaxUse=500M`
  i `MaxRetentionSec=2week`.

Co jest faktycznie w użyciu:

```bash
podman inspect rezervio-api --format '{{.HostConfig.LogConfig}}'
journalctl --user --disk-usage
du -sh /var/log/journal
```

---

## Metryki i alerty

Bez Prometheusa i bez Grafany — na 2 GB RAM kolektor metryk zabrałby więcej,
niż jest wart. Metryki hosta daje DigitalOcean z agenta, który już tam jest.

**Do ustawienia ręcznie** (DigitalOcean → Monitoring → Alert policies):

| Alert | Próg | Dlaczego |
| --- | --- | --- |
| CPU | > 80 % przez 10 min | jeden vCPU; dłuższe nasycenie to kolejka żądań |
| Memory | > 85 % przez 10 min | swap zaczyna boleć, zanim OOM zabije proces |
| Disk | > 80 % | dziennik, obrazy i backupy rosną; pełny dysk zatrzyma PostgreSQL-a |
| Droplet down | natychmiast | |

**Uptime check** (DigitalOcean Uptime albo dowolny zewnętrzny — musi być *poza*
tym dropletem, inaczej sprawdza sam siebie):

```text
https://rezervio.pl/             oczekiwane 200
https://rezervio.pl/api/health   oczekiwane 200, body {"status":"ok"}
```

Obie rzeczy wymagają konta i klikania w panelu. Dopóki nikt tego nie zrobi,
**nie są skonfigurowane** — repozytorium nie jest w stanie ich włączyć.

Doraźnie, z dropleta:

```bash
podman stats --no-stream
free -h && df -h / && uptime
```

---

## Backup

`deploy/backup.sh`, uruchamiany codziennie przez `rezervio-backup.timer`
(03:20 UTC, `Persistent=true`, więc droplet wyłączony o tej godzinie dostanie
swój backup po powrocie).

```bash
./backup.sh dump              # zrzut + retencja + kopia poza host
./backup.sh list
./backup.sh verify            # odtworzenie do bazy-piaskownicy
./backup.sh restore <plik>    # DESTRUKCYJNE
systemctl --user list-timers rezervio-backup
journalctl --user -u rezervio-backup -n 50
```

Format `pg_dump -Fc`: skompresowany przez samego pg_dumpa i odtwarzalny
selektywnie. Każdy zrzut jest od razu czytany przez `pg_restore --list` — plik,
którego `pg_restore` nie umie otworzyć, nie jest liczony jako backup.

Retencja lokalna: **7 dziennych, 4 tygodniowe (poniedziałki), 3 miesięczne
(pierwsze dni miesiąca)**. Retencję w buckecie ustaw regułą lifecycle — pętla
kasująca po stronie skryptu jest gorsza do pomylenia.

> **Backup wyłącznie na tym droplecie to nie jest backup.** Chroni przed złą
> migracją i przed niczym więcej. `backup.sh` **kończy się błędem**, gdy
> `BACKUP_S3_BUCKET` nie jest ustawiony — żeby brak kopii poza hostem nie
> wyglądał jak udany backup. Świadome odstępstwo:
> `BACKUP_ALLOW_LOCAL_ONLY=true`.

### Odtworzenie

```bash
sudo -iu rezervio && cd /opt/rezervio

# 1. Nic nie może pisać w trakcie.
podman compose -f compose.prod.yml stop api worker

# 2. Jeśli kopia jest w buckecie, ściągnij ją najpierw.
rclone copy ":s3:$BACKUP_S3_BUCKET/postgres/rezervio-….dump" backups/ \
  --s3-provider Other --s3-endpoint "$BACKUP_S3_ENDPOINT" \
  --s3-access-key-id "$BACKUP_S3_ACCESS_KEY_ID" \
  --s3-secret-access-key "$BACKUP_S3_SECRET_ACCESS_KEY"

# 3. Odtworzenie — pyta o potwierdzenie, jedna transakcja.
./backup.sh restore backups/rezervio-….dump

# 4. Z powrotem.
podman compose -f compose.prod.yml up -d api worker
curl -s localhost:3001/api/ready | jq
```

### Weryfikacja, że backup w ogóle działa

`./backup.sh verify` odtwarza najnowszy zrzut do bazy `rezervio_restore_check`
w tym samym kontenerze, liczy wiersze i tabele, po czym ją kasuje. Nie dotyka
ani jednego produkcyjnego wiersza, więc można to robić w zwykły wtorek — i
trzeba, bo jedyne pytanie o backup brzmi „czy się odtwarza".

---

## Rollback

```text
GitHub → Actions → Deploy Production
  git_ref          <SHA poprzedniego wydania>
  skip_migrations  true
```

Albo z dropleta:

```bash
sudo -iu rezervio && cd /opt/rezervio
./rollback.sh                 # ostatnie wydanie inne niż bieżące
./rollback.sh <sha>
cat releases.log              # co po czym szło
```

Obrazy poprzedniego wydania zostają na dysku, więc cofnięcie zwykle nic nie
pobiera.

> **Rollback aplikacji nie cofa migracji bazy.** Jeżeli wydanie, które cofasz,
> zmieniło schemat w sposób niezgodny wstecz, stary kod zastanie strukturę,
> której nie zna. Wtedy jedyną drogą jest `backup.sh restore` — i dlatego
> migracje produkcyjne mają być zgodne wstecz.

---

## Pierwszy cutover

Droplet serwuje dziś starą, wyłącznie frontendową aplikację: `rezervio.service`
jako root, z `/root/reservio`, bez API i bez bazy. Poniższa kolejność wymienia
ją na nowy stack tak, żeby w żadnym momencie nie zostać z niczym.

Stara aplikacja **nie jest** ścieżką rollbacku dla nowej. Rollback nowej wersji
idzie przez poprzedni SHA obrazu.

Stara usługa i nowy `web` chcą tego samego portu 3000, więc jednej trzeba
ustąpić. Do kroku 5 włącznie nic nie rusza ruchu produkcyjnego.

```text
 1. Push brancha / ref-a do GitHuba.
 2. CI zielone.                              Actions → CI
 3. Obrazy dla tego SHA są w GHCR.           Packages → api / web / postgres
 4. setup.sh na droplecie.                   patrz „Pierwsza konfiguracja hosta"
       .env.production uzupełniony, 0600, własność rezervio
       authorized_keys dla użytkownika rezervio
       podman login ghcr.io, jeśli pakiety są prywatne
 5. Ściągnij obrazy z wyprzedzeniem — to najdłuższy krok wdrożenia,
    a niczego jeszcze nie zmienia:
       sudo -iu rezervio
       for i in api web postgres; do
         podman pull ghcr.io/<owner>/rezervio/$i:<sha>
       done

 ── od tego momentu rezervio.pl jest chwilowo niedostępne ──

 6. Zatrzymaj starą usługę (zwalnia port 3000):
       systemctl stop rezervio && systemctl disable rezervio
 7. Wydanie:
       Actions → Deploy Production → git_ref = <ref>
    deploy.sh podnosi postgresa i redisa, czeka na pg_isready, wykonuje
    migracje na pustej bazie, startuje api + worker + web i sprawdza health.
 8. Rozszerzenia są na miejscu:
       podman exec rezervio-postgres psql -U rezervio -d rezervio -c '\dx'
    (oczekiwane: postgis, pg_trgm, vector, btree_gist)
 9. Health lokalnie:
       curl -s localhost:3001/api/health
       curl -s localhost:3001/api/ready
       curl -sI localhost:3000/ | head -1
10. Nginx — setup.sh zainstalował już konfigurację z /api/:
       nginx -t && systemctl reload nginx
11. Smoke testy przez domenę — lista niżej.
12. Ustaw zmienną repozytorium PUBLIC_BASE_URL=https://rezervio.pl,
    żeby kolejne wdrożenia sprawdzały też ścieżkę publiczną.
13. Dopiero teraz usuń pozostałości starego wdrożenia:
       rm /etc/systemd/system/rezervio.service && systemctl daemon-reload
       rm -rf /root/reservio
    i skasuj deploy/rezervio.service z repozytorium.
```

Okno niedostępności to czas między krokiem 6 a końcem kroku 7 — w praktyce
kilka minut, bo obrazy są już na dysku, a migracje idą na pustą bazę.

### Smoke testy po cutoverze

```text
Home                     https://rezervio.pl/
Search                   /search?destination=Gdansk
Property                 wejście w ofertę z wynikami
Wybór dat na Property    kalendarz, PriceQuote, CTA
Booking                  prośba albo rezerwacja natychmiastowa
Payment (sandbox)        karta 4242 4242 4242 4242
Webhook                  rezerwacja przechodzi w CONFIRMED
My Trips                 rezerwacja widoczna po claimie
Host login               /host/login → pulpit
Host: nowy obiekt        szkic, edycja, publikacja, zdjęcie (S3!)
Admin                    /admin po `grant-role.js … ADMIN`
Worker                   journalctl --user CONTAINER_NAME=rezervio-worker
Restart stacku           systemctl --user restart rezervio-stack
Reboot dropleta          reboot → stack wraca sam
```

Zdjęcie obiektu jest tu najważniejszym pojedynczym testem: to jedyna ścieżka,
która dotyka zewnętrznego object storage, i jedyna, której nie da się sprawdzić
bez prawdziwych kluczy do Spaces.

---

## Diagnostyka

```bash
# Co działa i na czym
podman ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}'
cat /opt/rezervio/.env            # RELEASE_SHA
tail -5 /opt/rezervio/releases.log

# API nie wstaje
podman compose -f compose.prod.yml logs --tail 100 api
#  → "Brak wymaganej zmiennej X"     uzupełnij .env.production
#  → "klucz live"                    Rezervio jest sandbox-only, użyj sk_test_
#  → ECONNREFUSED postgres           podman compose ps, logs postgres

# 502 z nginxa
curl -sI localhost:3000/ ; curl -s localhost:3001/api/health
systemctl status nginx && nginx -t

# Migracja padła
podman compose -f compose.prod.yml run --rm --no-deps api \
  node dist/infrastructure/database/migrate.js

# Kolejki stoją
podman logs rezervio-worker --tail 100
podman exec rezervio-redis redis-cli info keyspace
#  → panel /admin → Zadania pokazuje wyczerpane ponowienia

# Zdjęcia się nie wyświetlają
#  → S3_PUBLIC_BASE_URL musi być identyczny w .env.production i w build-argu
#    obrazu web; to on wchodzi do CSP img-src i do images.remotePatterns.
podman exec rezervio-api printenv S3_PUBLIC_BASE_URL

# Miejsce na dysku
df -h / && podman system df && du -sh /opt/rezervio/backups
podman image prune -f
```

---

## Budżet zasobów

```text
1 vCPU · 2 GB RAM · 70 GB dysk · FRA1
```

Dlatego: żadnego builda na produkcji, żadnego Kubernetesa, żadnego ciężkiego
stacku obserwowalności, ostrożne `concurrency` workera, rotacja logów, swap
zostaje.

Ceilingi w `.env.production`:

```text
WORKER_CONCURRENCY=2      tylko OBNIŻA to, o co prosi każdy worker
API_HEAP_MB=384           ograniczony heap zamiast OOM-killera
WORKER_HEAP_MB=320
WEB_HEAP_MB=320
REDIS_MAXMEMORY=192mb
```

`WORKER_CONCURRENCY` jest sufitem, nie mnożnikiem: literówka w tym pliku nie
zrobi droplet owi tego, przed czym ta zmienna ma go bronić. Reszta PostgreSQL-a
i Redisa zostaje na domyślnych — bez pomiarów strojenie jest zgadywaniem.

---

## Pliki

| Plik | Rola |
| --- | --- |
| `deploy/setup.sh` | bootstrap hosta; nie buduje aplikacji |
| `deploy/deploy.sh` | wydanie: pull → migracje → up → health |
| `deploy/rollback.sh` | poprzedni SHA, bez migracji |
| `deploy/backup.sh` | pg_dump, retencja, kopia poza host, restore, weryfikacja |
| `deploy/compose.prod.yml` | web · api · worker · postgres · redis |
| `deploy/compose.storage.yml` | opcjonalne MinIO; sama obecność pliku włącza |
| `deploy/nginx.conf` | reverse proxy, `/` → web, `/api/` → api |
| `deploy/tls.sh` | Let's Encrypt dla domeny i www |
| `deploy/env.production.example` | wzór `/opt/rezervio/.env.production` |
| `deploy/gen-secrets.sh` | generuje hasła i klucze szyfrujące (uruchamiane lokalnie) |
| `deploy/rezervio-stack.service` | systemd --user; start po reboocie |
| `deploy/rezervio-backup.{service,timer}` | codzienny backup |
| `deploy/rezervio.service` | **legacy** — stare wdrożenie, do usunięcia po cutoverze |
| `containers/postgres/` | PostGIS + pg_trgm + pgvector |
| `.github/workflows/ci.yml` | bramki jakości |
| `.github/workflows/images.yml` | budowa i publikacja obrazów |
| `.github/workflows/deploy-production.yml` | ręczne wdrożenie wybranego ref-a |
