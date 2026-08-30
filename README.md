# rezervio°

Marketplace noclegów, w którym **cena całkowita** jest widoczna od pierwszego ekranu.

> Hosts pay less. Guests pay less.

Next.js pobiera dane przez REST z NestJS, źródłem prawdy jest PostgreSQL —
z PostGIS, pełnotekstowym wyszukiwaniem, `pg_trgm` i `daterange` dla
dostępności — zdjęcia obiektów leżą w storage zgodnym z S3, a synchronizacja
kalendarzy chodzi przez Redis i BullMQ.

## Wymagania

- **Node.js 20.9+** (Next 16 i NestJS 11)
- **pnpm 9+**
- **Podman** — preferowany lokalny container runtime; Docker Desktop nie jest wymagany

Na macOS Podman działa przez maszynę wirtualną:

```bash
podman machine init    # tylko przy pierwszym uruchomieniu
podman machine start
podman info            # weryfikacja
```

## Uruchomienie

```bash
git clone https://github.com/awojcik/reservio.git
cd reservio

pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env

pnpm infra:start   # PostgreSQL + object storage + Redis + Mailpit (obrazy przy pierwszym starcie)
pnpm db:migrate
pnpm db:seed

pnpm dev           # web + api równolegle
```

| Co | Adres |
| --- | --- |
| Web | http://localhost:3000 |
| Konto i podróże | http://localhost:3000/account |
| Panel gospodarza | http://localhost:3000/host |
| Rezerwacje gospodarza | http://localhost:3000/host/bookings |
| API | http://localhost:3001/api |
| Swagger | http://localhost:3001/api/docs |
| OpenAPI | http://localhost:3001/api/openapi.json |
| Object storage (S3) | http://localhost:9000 |
| Konsola storage | http://localhost:9001 |
| Redis (kolejka) | localhost:6379 |
| Skrzynka e-mail (Mailpit) | http://localhost:8025 |

### Konto demo

Seed zakłada gospodarza z katalogiem demo. **Wyłącznie do developmentu:**

```text
host@rezervio.local / rezervio-demo-2026
```

To konto ma profil gospodarza, więc widzi zarówno `/account`, jak i `/host`.
Zwykłe konto gościa założysz na `/register`.

## Konto i Moje podróże

Rezervio ma **jedno konto** dla obu ról:

```text
User
├── Moje podróże            (rezerwacje)
└── Profil gospodarza       (opcjonalny)
    └── Panel gospodarza
```

Ta sama osoba rezerwuje cudze obiekty i wystawia własne — bez drugiego konta
i bez przełączania sesji.

| Trasa | Co robi |
| --- | --- |
| `/register` | zakłada konto (sam `User`) |
| `/login` | wspólne logowanie |
| `/account` | pulpit: nadchodzące podróże, oczekujące prośby |
| `/account/trips` | wszystkie rezerwacje, z filtrami |
| `/account/profile` | imię, nazwisko, telefon, język |
| `/host/register` | zakłada konto **razem** z profilem gospodarza |

Konto z profilem gospodarza widzi w nagłówku dodatkowo **Panel gospodarza**.

### Konto nie jest wymagane

Rezerwować można **bez rejestracji** — i tak zostaje. Rezerwacja anonimowa ma
`guest_user_id = NULL`, a dane kontaktowe zapisujemy jako snapshot.

Zalogowany gość dostaje formularz wypełniony danymi z profilu, ale może je
zmienić — należą do tej konkretnej rezerwacji, nie do konta. **Późniejsza edycja
profilu nie zmienia historycznych rezerwacji.**

### Dopisanie anonimowej rezerwacji do konta

Na stronie statusu rezerwacji pojawia się „Zapisz tę podróż na koncie". Żeby
przypisanie doszło do skutku, muszą zgadzać się **trzy rzeczy naraz**:

```text
zalogowane konto
+ ważny token dostępu z linku w mailu
+ zgodny adres email
```

Sam numer rezerwacji ani sam adres email **nie wystarczają** — numer jest
drukowany w mailu i dyktowany przez telefon, a adres to wiedza publiczna.
Rezerwacja należąca już do innego konta nie da się przejąć.

### Podróże przeżywają archiwizację obiektu

Rezerwacja trzyma własny snapshot tytułu, miasta i okładki, więc „Moje podróże"
wygląda poprawnie nawet po tym, jak gospodarz wycofa obiekt z publikacji.

### Własnego obiektu nie zarezerwujesz

Gospodarz nie zarezerwuje własnego obiektu — pilnuje tego backend
(`409 CANNOT_BOOK_OWN_PROPERTY`), nie ukryty przycisk.

## Panel gospodarza

Rejestracja jest otwarta — `/host/register` tworzy w jednej transakcji `User`,
`Host` i sesję, po czym przenosi do panelu.

```text
/host/register  →  /host  →  /host/properties/new  →  /host/properties/[id]
                                                             ↓
                                          uzupełnij → zdjęcia → Opublikuj
                                                             ↓
                                              publiczny /search i /property/[slug]
```

Nowy obiekt powstaje jako **szkic** (`DRAFT`) i może być niekompletny. Panel
pokazuje, czego jeszcze brakuje do publikacji — ta lista pochodzi z backendu,
który jest jedynym źródłem prawdy dla reguł publikacji.

Cykl życia obiektu:

```text
DRAFT ──publish──▶ PUBLISHED ──unpublish──▶ SUSPENDED
  │                    │                        │
  └────────────────────┴────archive─────────────┴──▶ ARCHIVED
```

Tylko `PUBLISHED` trafia do publicznej wyszukiwarki. `ARCHIVED` jest stanem
końcowym — niczego nie usuwamy twardo.

Sesje są server-side w `HttpOnly` cookie, hasła hashowane Argon2id. Gospodarz
widzi i zmienia wyłącznie własne obiekty; cudzy obiekt zwraca `404`.

## Zdjęcia i object storage

Zdjęcia nie przechodzą przez API — przeglądarka dostaje **presigned URL**
i wysyła plik wprost do storage, a backend zapisuje dopiero potwierdzone
`PropertyImage`.

Lokalnie storage to MinIO uruchamiane przez `pnpm infra:start`. Bucket i polityka
publicznego odczytu tworzą się same przy starcie API — nic nie trzeba klikać
w konsoli.

Limity (walidowane po stronie serwera): JPEG/PNG/WebP, 10 MB na zdjęcie,
30 zdjęć na obiekt. `position = 0` to zdjęcie główne.

Produkcyjnie ten sam kod działa na DigitalOcean Spaces — wystarczy zmienić
zmienne `S3_*`. Lista hostów dozwolonych dla `next/image` jest wyprowadzana
z `S3_PUBLIC_BASE_URL`, więc zmiana storage nie wymaga edycji `next.config.ts`.

### Zdjęcia nie opuszczają Twojego komputera

Przeglądarka wysyła plik wprost pod adres z `S3_ENDPOINT`, czyli lokalnie do
kontenera MinIO. Nic nie jest wysyłane na zewnątrz.

Bucket ma politykę publicznego odczytu (żeby `next/image` mógł pobrać zdjęcie
bez podpisywania każdego żądania), dlatego **wszystkie porty infrastruktury są
związane z `127.0.0.1`**, a nie z `0.0.0.0`:

```text
127.0.0.1:5432   PostgreSQL
127.0.0.1:9000   object storage (S3)
127.0.0.1:9001   konsola storage
127.0.0.1:6379   Redis
127.0.0.1:1025   SMTP (Mailpit)
127.0.0.1:8025   skrzynka Mailpit
```

Inny komputer w tej samej sieci nie dosięgnie ani bazy, ani zdjęć. Jeśli
świadomie chcesz testować z telefonu w tej samej sieci, zmień bindy
w `scripts/infra.sh` i `compose.yml` — ale wtedy wgrane zdjęcia stają się
dostępne dla całej sieci lokalnej.

Next 16 domyślnie odmawia optymalizacji obrazów z hostów rozwiązujących się na
prywatne IP (ochrona przed SSRF). Lokalne MinIO jest właśnie takim hostem, więc
`images.dangerouslyAllowLocalIP` jest włączone **wyłącznie w developmencie** —
w produkcji `S3_PUBLIC_BASE_URL` wskazuje publiczny host i flaga pozostaje
wyłączona.

## Kalendarz i dostępność

Każdy obiekt ma kalendarz pod `/host/properties/[id]/calendar`. Zaznacz zakres
dwoma kliknięciami, a potem zablokuj albo zwolnij termin.

```text
blokada [12.09, 16.09)  →  pobyt 13–15.09 nie znajdzie obiektu
                        →  pobyt 16–18.09 znajdzie
```

Daty są **półotwarte**: dzień końcowy to dzień wyjazdu i pozostaje wolny.
Zdjęcie fragmentu blokady w środku dzieli ją na dwie — nie trzeba kasować całości.

Zablokowane terminy znikają z wyszukiwarki natychmiast; filtrowanie dzieje się
w SQL, nie na froncie.

### Import z innych serwisów

Podepnij feed iCal z Airbnb, Booking.com, Vrbo albo PMS-a. Rezervio odpytuje go
okresowo (domyślnie co 15 minut) i traktuje jak pełny obraz stanu: po każdej
udanej synchronizacji terminy są dopasowywane, a te, których feed już nie
wymienia, znikają.

Nieudana synchronizacja **nie kasuje** poprzednich blokad — awaria cudzego
serwera nie może przypadkiem otworzyć Twojego kalendarza.

> Kalendarze iCal nie synchronizują się w czasie rzeczywistym.

Adres feedu bywa poufny (często zawiera token), więc jest szyfrowany
AES-256-GCM, nie trafia do logów i nigdy nie wraca przez API w całości.

Backend pobiera tylko publiczne adresy: schemat `http`/`https`, z odrzuceniem
`localhost`, sieci prywatnych i endpointów metadanych chmury — sprawdzane też
po DNS i przy każdym przekierowaniu.

Żeby przetestować import lokalnym mockiem, ustaw w `.env`:

```env
ICAL_ALLOW_PRIVATE_HOSTS=true
```

Ta furtka jest ignorowana przy `NODE_ENV=production` — na produkcji ochrony
SSRF nie da się wyłączyć konfiguracją.

### Eksport do innych serwisów

Wygeneruj adres `.ics`, który zewnętrzny system może zasubskrybować. Token
pokazujemy raz, w bazie leży wyłącznie jego hash, a rotacja natychmiast
unieważnia poprzedni adres.

Eksport obejmuje **tylko blokady ręczne**. Terminy zaimportowane z cudzych
kalendarzy nigdy nie są odsyłane — inaczej dwa serwisy blokowałyby się
nawzajem w kółko. Feed nie zawiera notatek ani danych osobowych.

## Rezerwacje

Każdy obiekt ma **tryb rezerwacji**, ustawiany w edytorze (krok 6):

```text
REQUEST_TO_BOOK   (domyślny)  gospodarz akceptuje każdą rezerwację
INSTANT_BOOK                  gość rezerwuje od razu
```

Ścieżka gościa:

```text
/property/[slug]  →  „Wyślij prośbę" / „Zarezerwuj"
        ↓
/booking/[slug]   →  termin, cena, dane kontaktowe
        ↓
/booking/status/[reference]
```

Gość nie potrzebuje konta. Rezerwacja zapisuje snapshot jego danych i **snapshot
ceny** — późniejsza zmiana stawki przez gospodarza nie rusza tego, co już
uzgodniono. Cenę wylicza serwer; kwota przysłana przez przeglądarkę jest
ignorowana.

Gospodarz widzi prośby w **/host/bookings** i tam je akceptuje albo odrzuca.

### Statusy

| Status | Znaczenie |
| --- | --- |
| `PENDING_HOST_APPROVAL` | czeka na gospodarza — **termin pozostaje wolny** |
| `PENDING_PAYMENT` | termin zablokowany Holdem, czeka na płatność |
| `CANCELLED` | odrzucona przez gospodarza |
| `EXPIRED` | Hold wygasł albo termin zajął się przed akceptacją |
| `CONFIRMED` | dopiero po płatności (Milestone 05) |

Prośba o rezerwację celowo **nie blokuje** kalendarza — inaczej niezdecydowany
gospodarz zamrażałby termin, nie podejmując decyzji. Blokada powstaje dopiero
przy akceptacji, po ponownym sprawdzeniu dostępności.

### Ochrona przed podwójną rezerwacją

Dwóch gości klikających „Zarezerwuj" w tej samej sekundzie nie może obaj wygrać.
Każdy zapis zmieniający dostępność bierze **advisory lock PostgreSQL na
Property**, przeładowuje stan i sprawdza dostępność **ponownie, wewnątrz
transakcji**. Drugi dostaje `409 PROPERTY_NOT_AVAILABLE`.

`POST /api/bookings` wymaga nagłówka `Idempotency-Key`: ponowione wysłanie
formularza zwraca tę samą rezerwację, a nie drugą.

Hold wygasa po `BOOKING_HOLD_TTL_SECONDS` (domyślnie 10 minut) i **przestaje
blokować natychmiast** — nawet jeśli job sprzątający się spóźni. Redis obsługuje
tylko sprzątanie; źródłem prawdy o dostępności jest PostgreSQL.

## Powiadomienia i lokalne testowanie e-maili

Wszystkie maile lokalnie łapie **Mailpit** — nic nie wychodzi na zewnątrz.
Skrzynkę otwierasz w przeglądarce:

```text
http://localhost:8025
```

Kiedy co wychodzi:

| Zdarzenie | Do kogo |
| --- | --- |
| Nowa prośba o rezerwację | gospodarz |
| Przypomnienie przed wygaśnięciem prośby | gospodarz |
| Gość anulował | gospodarz |
| Prośba zaakceptowana | gość |
| Prośba odrzucona | gość |
| Prośba wygasła | gość |
| Gospodarz anulował | gość |

Email jest **efektem ubocznym**, nigdy częścią transakcji. Zmiana stanu
rezerwacji i zapis do outboxa dzieją się razem, a wysyłka dopiero po commicie —
awaria SMTP nie może zablokować rezerwacji. Każde powiadomienie ma logiczny
klucz dedup, więc ponowienie nie wyśle drugiego maila.

## Rezerwacja z perspektywy gościa

Gość nie zakłada konta. Po wysłaniu formularza dostaje **bezpieczny link**:

```text
/booking/status/RZV-XXXXXXXX?token=…
```

Token jest wymieniany na `HttpOnly` cookie i znika z adresu. Sam numer
rezerwacji **nie wystarcza** — jest drukowany w mailu i dyktowany przez telefon,
więc identyfikuje rezerwację, ale niczego nie autoryzuje.

Na stronie statusu gość widzi termin, cenę, status, historię i — jeśli to
jeszcze możliwe — przycisk anulowania.

### Wygasanie prośby

Prośba o rezerwację ma deadline (`BOOKING_REQUEST_TTL_SECONDS`, domyślnie 24 h).
Deadline leży **w bazie**, nie w kolejce: gospodarz nie zaakceptuje prośby po
czasie, nawet jeśli worker jeszcze nie zdążył jej domknąć.

Kilka godzin przed końcem gospodarz dostaje przypomnienie
(`BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY`).

### Anulowanie

Anulować mogą obie strony, dopóki rezerwacja czeka na gospodarza albo na
płatność. Jeśli termin był zablokowany, blokada znika w tej samej transakcji
i obiekt od razu wraca do wyszukiwarki.

## Skrypty

| Komenda | Opis |
| --- | --- |
| `pnpm dev` | web + api równolegle |
| `pnpm dev:web` / `pnpm dev:api` | pojedyncza aplikacja |
| `pnpm build` | build wszystkich pakietów |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | kontrola jakości w całym monorepo |
| `pnpm infra:start` / `pnpm infra:stop` | lokalna infrastruktura (baza + storage + Redis + Mailpit) |
| `pnpm infra:reset` | usuwa wolumeny i stawia infrastrukturę od zera |
| `pnpm db:migrate` / `pnpm db:seed` | migracje i dane demo (seed jest idempotentny) |
| `pnpm db:reset` | infrastruktura od zera + migracje + seed |
| `pnpm db:generate` | nowa migracja Drizzle ze zmian w schemacie |
| `pnpm api:types` | regeneruje typy klienta z OpenAPI (API musi działać) |

`pnpm infra:start` używa `podman compose`, jeśli w systemie jest provider
Compose. Gdy go nie ma — a `podman compose` wymaga zewnętrznego
`docker-compose` albo `podman-compose` — skrypt uruchamia te same kontenery
bezpośrednio przez `podman run`. `compose.yml` pozostaje deklaratywnym opisem
tej samej infrastruktury.

Testy integracyjne i smoke API korzystają z lokalnej bazy — przed `pnpm test`
uruchom `pnpm infra:start && pnpm db:migrate && pnpm db:seed`.

## Struktura

```text
apps/
  web/          Next.js — UI publiczne, panel gospodarza, mapa
  api/          NestJS + Fastify — REST, auth, Drizzle, migracje, seed
packages/
  api-client/   typowany fetch client z typami generowanymi z OpenAPI
containers/
  postgres/     obraz z PostGIS, pg_trgm i pgvector
docs/           język domenowy, architektura, milestone'y
deploy/         skrypty wdrożeniowe na droplet
compose.yml     lokalna infrastruktura (baza + object storage + Redis + Mailpit)
scripts/        infra.sh — start/stop/reset infrastruktury
```

Szczegóły: [docs/architecture.md](docs/architecture.md).
Terminologia: [docs/rezervio-domain-language.md](docs/rezervio-domain-language.md).

## Dane

Katalog demo (31 Property, jeden Host, 15 Amenity) żyje w jednym miejscu:
`apps/api/src/infrastructure/database/seed/demo-properties.ts`. Frontend nie ma
własnej kopii — wszystko pobiera z API.

Żeby dodać obiekt: dopisz rekord do `DEMO_PROPERTIES` i uruchom `pnpm db:seed`.
Kwoty podawaj w **minor units** (`45000` = 450,00 PLN), a kody Amenity wielkimi
literami (`SEA_VIEW`). Nowy host obrazków wymaga wpisu w `images.remotePatterns`
w `apps/web/next.config.ts`.

Kanoniczna lista Amenity mieszka w `apps/api/src/domain/amenities.ts` i jest
wystawiona pod `GET /api/amenities` — seed, panel gospodarza i filtry korzystają
z tego samego źródła.

## Zmiany w schemacie

Zawsze przez migracje, nigdy przez `push`:

```bash
# 1. zmień apps/api/src/infrastructure/database/schema.ts
pnpm db:generate
# 2. przejrzyj wygenerowany SQL w apps/api/drizzle/
pnpm db:migrate
```

Rzeczy, których Drizzle nie modeluje — rozszerzenia, kolumna `geography`,
`tsvector`, indeksy GiST/GIN/trigram — są w ręcznej migracji
`apps/api/drizzle/0001_geo_and_search.sql`.

## Środowisko

`.env` w korzeniu obsługuje API i skrypty bazodanowe; `apps/web/.env` obsługuje
Next.js, który czyta zmienne z katalogu aplikacji, nie z korzenia monorepo.
Wzorce bez sekretów są w `.env.example`.

Klucz szyfrowania adresów iCal wygeneruj sam — bez niego API nie wstanie:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Wynik wpisz do `ICAL_URL_ENCRYPTION_KEY` w `.env`.

Zmienne dodane w Milestone 05:

```env
APP_BASE_URL=http://localhost:3000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
EMAIL_FROM=no-reply@rezervio.local

BOOKING_REQUEST_TTL_SECONDS=86400
BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY=14400
```

Linki w mailach budujemy **wyłącznie** z `APP_BASE_URL`, nigdy z nagłówka
`Host` żądania.

Zmienne dodane w Milestone 04:

```env
BOOKING_HOLD_TTL_SECONDS=600
BOOKING_IDEMPOTENCY_TTL_SECONDS=86400
```

Zmienne dodane w Milestone 03:

```env
REDIS_URL=redis://localhost:6379

ICAL_SYNC_INTERVAL_MINUTES=15
ICAL_FETCH_TIMEOUT_MS=10000
ICAL_MAX_RESPONSE_BYTES=5242880
ICAL_URL_ENCRYPTION_KEY=
ICAL_ALLOW_PRIVATE_HOSTS=false
```

Zmienne dodane w Milestone 02:

```env
SESSION_COOKIE_NAME=rezervio_session
SESSION_TTL_SECONDS=604800

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=rezervio-local
S3_ACCESS_KEY_ID=rezervio
S3_SECRET_ACCESS_KEY=rezervio-local-only
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_BASE_URL=http://localhost:9000/rezervio-local
```

Cookie sesji ma `Secure` wyłącznie przy `NODE_ENV=production` — na localhost
bez HTTPS przeglądarka by je odrzuciła.

## Wdrożenie

Zobacz [DEPLOY.md](DEPLOY.md).
