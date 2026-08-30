# Rezervio — Milestone 01: Backend Foundation + Real Property Search

> Cel: zastąpić mockowane dane prawdziwym backendem NestJS + PostgreSQL, bez zmiany obecnego UX i designu aplikacji.

---

# 0. Najważniejsze instrukcje dla agenta

Pracujesz na istniejącym repozytorium Rezervio.

**Najpierw przeanalizuj aktualny kod i strukturę repozytorium. Nie zakładaj, że repo wygląda dokładnie tak jak w tej specyfikacji.**

Przed zmianami przeczytaj:

```text
docs/domain-language.md
```

Jeżeli dokument ma inną nazwę, znajdź dokument zawierający canonical domain language Rezervio.

Terminologia z tego dokumentu jest wiążąca.

W szczególności używamy:

```text
Property
Listing
Host
Guest
Stay
Availability
DailyRate
PriceQuote
Booking
BookingHold
Payment
Payout
PlatformFee
Amenity
```

Nie wprowadzaj synonimów takich jak:

```text
Offer
Accommodation
RentalObject
Reservation
Customer
Landlord
```

jeżeli istnieje już termin kanoniczny.

---

# 1. Zakres milestone

Po zakończeniu tego milestone obecna aplikacja frontendowa ma wyglądać i działać wizualnie **tak samo jak teraz**, ale:

```text
BEFORE

Next.js
   ↓
mock properties.ts
```

ma zostać zastąpione przez:

```text
AFTER

Next.js
   ↓ HTTP
NestJS + Fastify
   ↓
PostgreSQL
```

Zakres obejmuje:

1. przygotowanie monorepo;
2. zachowanie istniejącego frontendowego Next.js;
3. utworzenie backendu NestJS;
4. uruchomienie NestJS na Fastify;
5. uruchomienie PostgreSQL;
6. dodanie rozszerzeń:
   - PostGIS,
   - pg_trgm,
   - pgvector;
7. konfigurację Drizzle ORM;
8. migracje;
9. seed istniejących mockowanych Property;
10. REST API;
11. podstawowy full-text/fuzzy/geo-ready search;
12. podłączenie istniejącego `/search` do API;
13. podłączenie istniejącego `/property/[id]` do API;
14. Swagger/OpenAPI;
15. testy;
16. OCI-compatible Compose dla lokalnej bazy, z **Podmanem jako preferowanym lokalnym runtime**;
17. health check;
18. dokumentację uruchomienia.

---

# 2. Poza zakresem

W tym milestone **NIE implementuj**:

- logowania;
- rejestracji;
- Host dashboard;
- dodawania Property z UI;
- Booking;
- BookingHold;
- Payment;
- Payout;
- Refund;
- iCal;
- PMS integrations;
- Redis;
- BullMQ;
- AI;
- generowania embeddings;
- semantic/vector retrieval;
- OpenSearch;
- Vespa;
- Elasticsearch;
- aplikacji mobilnej;
- deploymentu produkcyjnego.

`pgvector` ma zostać zainstalowany jako fundament pod przyszły semantic search, ale **nie generujemy jeszcze embeddings**.

---

# 3. Priorytety

Kolejność priorytetów:

1. nie zepsuć istniejącego UI;
2. poprawność danych;
3. prostota;
4. type safety;
5. poprawne granice domenowe;
6. możliwość dalszego rozwoju;
7. wydajność odpowiednia dla MVP.

Nie over-engineeruj.

Architektura:

```text
Modular Monolith
```

Nie twórz mikroserwisów.

---

# 4. Docelowa struktura repo

Jeżeli aktualny projekt nie jest monorepo, przekształć go do:

```text
rezervio/
├── apps/
│   ├── web/
│   │   └── existing Next.js application
│   │
│   └── api/
│       └── NestJS application
│
├── packages/
│   ├── api-client/
│   └── config/
│
├── docs/
│   ├── domain-language.md
│   └── milestone-01-backend-foundation.md
│
├── containers/
│   └── postgres/
│
├── compose.yml
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

Jeżeli repo już używa poprawnej struktury monorepo — dostosuj się do niej zamiast robić niepotrzebny refactor.

---

# 5. Package manager

Użyj:

```text
pnpm
```

Root powinien posiadać workspace.

Przykład:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Root scripts powinny umożliwiać co najmniej:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Jeżeli warto, dodaj również:

```bash
pnpm dev:web
pnpm dev:api

pnpm db:start
pnpm db:stop
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

`pnpm dev` powinno uruchamiać web + api równolegle.

Skrypty infrastrukturalne powinny ukrywać szczegóły runtime tam, gdzie to praktyczne:

```text
pnpm db:start -> uruchamia PostgreSQL przez Podman Compose
pnpm db:stop  -> zatrzymuje lokalny PostgreSQL
```

Preferuj, aby developer na co dzień używał:

```bash
pnpm db:start
pnpm db:migrate
pnpm db:seed
pnpm dev
```

zamiast pamiętać bezpośrednie komendy Compose.

Nie dodawaj ciężkiego monorepo frameworka tylko dlatego, że jest popularny.

Turborepo jest dopuszczalne tylko jeśli rzeczywiście upraszcza istniejący setup.

---

# 6. Frontend

Obecny frontend:

```text
Next.js + React + TypeScript + Tailwind
```

ma zostać zachowany.

Nie zmieniaj:

- layoutu;
- kolorów;
- spacingu;
- design tokens;
- kart Property;
- mapy;
- filtrów;
- obecnego mobile UX;
- routingu publicznych stron;
- contentu marketingowego.

Ten milestone nie jest redesignem.

Jeżeli migracja do `apps/web` wymaga zmian importów — zrób je bez zmiany zachowania aplikacji.

---

# 7. Backend stack

Utwórz:

```text
apps/api
```

Stack:

```text
Language:      TypeScript
Runtime:       Node.js
Framework:     NestJS
HTTP adapter:  Fastify
API style:     REST
Docs:          OpenAPI / Swagger
Validation:    standard NestJS validation
Database:      PostgreSQL
ORM:           Drizzle ORM
```

Nie uruchamiaj NestJS na Express.

Backend lokalnie:

```text
http://localhost:3001
```

API prefix:

```text
/api
```

---

# 8. Backend modules

Na tym etapie utwórz:

```text
src/
├── main.ts
├── app.module.ts
│
├── modules/
│   ├── properties/
│   ├── search/
│   └── health/
│
└── infrastructure/
    └── database/
```

Nie twórz pustych modułów:

```text
payments
bookings
payouts
calendar-sync
```

tylko po to, żeby „były na przyszłość”.

Dodajemy moduł dopiero wtedy, kiedy ma implementację.

---

# 9. PostgreSQL

Użyj PostgreSQL kompatybilnego z:

```text
PostGIS
pg_trgm
pgvector
```

Lokalne środowisko ma być przygotowane pod **Podmana** i OCI-compatible Compose.

Preferowana komenda:

```bash
podman compose up -d db
```

Jeżeli lokalna instalacja używa osobnego wrappera:

```bash
podman-compose up -d db
```

Agent nie może wymagać Docker Desktop ani Docker Engine do developmentu.

Na macOS zakładamy, że Podman może działać przez `podman machine`. Jeżeli machine nie istnieje lub nie działa, dokumentacja ma wskazywać:

```bash
podman machine init
podman machine start
```

oraz weryfikację:

```bash
podman info
```

Upewnij się, że użyty OCI image PostgreSQL działa poprawnie pod Podmanem i zapewnia wszystkie wymagane rozszerzenia.

Po uruchomieniu/migracji baza musi wykonać:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
```

Jeżeli pojedynczy gotowy image nie zapewnia wszystkich rozszerzeń, przygotuj mały własny image PostgreSQL zamiast rezygnować z rozszerzeń.

Nie instaluj rozszerzeń ręcznie poza reproducible OCI/container setup.

---

# 10. Connection string

Development:

```text
DATABASE_URL=postgresql://rezervio:rezervio@localhost:5432/rezervio
```

Nie hardcoduj credentials w kodzie.

Dodaj:

```text
.env.example
```

bez sekretów.

---

# 11. Drizzle ORM

Użyj:

```text
drizzle-orm
drizzle-kit
```

Drizzle ma obsługiwać:

- schema definitions;
- typowy CRUD;
- migrations;
- seed.

Dla zaawansowanych zapytań PostGIS/FTS dopuszczalny i zalecany jest jawny SQL.

Nie próbuj za wszelką cenę ukrywać PostgreSQL za ORM.

---

# 12. Model danych — Host

Na potrzeby relacji Property potrzebujemy minimalnego Host.

Tabela:

```text
hosts
```

Pola:

```text
id
display_name
created_at
updated_at
```

Na tym milestone nie implementujemy Host authentication ani panelu.

Seed tworzy jednego lub kilku demo Host.

---

# 13. Model danych — Property

Tabela:

```text
properties
```

Minimum:

```text
id
host_id
slug
title
description

property_type
status

city
district
country_code
time_zone

latitude
longitude

max_guests
bedrooms
beds
bathrooms

rating
review_count

distance_to_beach_meters

base_daily_rate_amount_minor
cleaning_fee_amount_minor
market_daily_rate_amount_minor
currency

created_at
updated_at
```

Dla MVP pola pricingowe mogą znajdować się na Property.

To jest świadome uproszczenie tylko na potrzeby przeniesienia obecnych mocków.

Nie twórz jeszcze rozbudowanego pricing engine.

`currency`:

```text
PLN
```

dla obecnych danych demo.

Kwoty przechowuj jako integer minor units.

Przykład:

```text
1920.00 PLN -> 192000
```

Nigdy nie używaj `float` dla pieniędzy.

---

# 14. Property status

Użyj zgodnie z domain language:

```text
DRAFT
IN_REVIEW
PUBLISHED
SUSPENDED
ARCHIVED
```

Seedowane Property:

```text
PUBLISHED
```

Publiczne endpointy nie zwracają innych statusów.

---

# 15. Property type

Użyj stabilnych wartości:

```text
APARTMENT
HOUSE
VILLA
STUDIO
```

Nie przechowuj lokalizowanych nazw.

---

# 16. Property location

Na poziomie aplikacji utrzymuj:

```text
latitude
longitude
```

ale baza powinna również mieć geo reprezentację nadającą się do indeksowania PostGIS.

Preferowane:

```sql
geography(Point, 4326)
```

lub równoważne rozwiązanie poprawnie wspierające:

```text
ST_DWithin
viewport bounds
distance
```

Dodaj odpowiedni indeks przestrzenny.

Nie wykonuj geo filtering w JavaScript po pobraniu wszystkich rekordów.

---

# 17. PropertyImage

Tabela:

```text
property_images
```

Pola:

```text
id
property_id
url
alt_text
position
created_at
```

Constraint:

```text
position >= 0
```

Kolejność obrazów ma być deterministyczna.

---

# 18. Amenity

Tabela:

```text
amenities
```

Pola:

```text
id
code
created_at
```

`code` unique.

Seeduj przynajmniej:

```text
WIFI
PARKING
POOL
AIR_CONDITIONING
WASHING_MACHINE
KITCHEN
BALCONY
ELEVATOR
SEA_VIEW
```

Relacja:

```text
property_amenities
```

Pola:

```text
property_id
amenity_id
```

Composite unique/primary key:

```text
(property_id, amenity_id)
```

---

# 19. Search text / full-text foundation

Dodaj fundament pod full-text search.

Search powinien brać pod uwagę co najmniej:

```text
title
description
city
district
```

Użyj PostgreSQL Full Text Search.

Preferowany indeks:

```text
GIN
```

Konfiguracja powinna dobrze działać z wielojęzycznymi opisami.

Na MVP dopuszczalne:

```text
simple
```

zamiast językowo-specyficznego dictionary.

Nie twórz jeszcze skomplikowanego rankingu ML.

---

# 20. pg_trgm

Użyj `pg_trgm` do fuzzy matching dla:

```text
city
district
title
```

Cel:

query typu:

```text
Gdansk
Gdańsk
gdans
```

powinny mieć sensowną tolerancję na niedokładności, jeśli jest to możliwe bez nadmiernej komplikacji.

Dodaj odpowiednie indeksy trigramowe tam, gdzie faktycznie są używane.

---

# 21. pgvector

Rozszerzenie:

```text
vector
```

musi być aktywne.

W tym milestone:

```text
NIE generujemy embeddings
NIE wykonujemy vector search
```

Nie dodawaj zależności od zewnętrznego AI API.

Jeżeli dodanie nullable `embedding` wymaga arbitralnego wyboru dimension — **nie dodawaj kolumny jeszcze**.

Wystarczy przygotować extension i dokumentację, że semantic search pojawi się w osobnym milestone.

---

# 22. Price calculation

Obecny frontend musi nadal móc wyświetlić:

```text
total price
number of nights
saving
```

Zaimplementuj backendową funkcję:

```text
calculatePriceQuote(property, checkIn, checkOut)
```

Zasady MVP:

```text
nights = checkOut - checkIn

accommodationAmount =
  nights * baseDailyRate

totalAmount =
  accommodationAmount + cleaningFee

marketAmount =
  nights * marketDailyRate + cleaningFee

saving =
  max(0, marketAmount - totalAmount)
```

Jeżeli `marketDailyRate` nie istnieje:

```text
saving = null
```

Walidacja:

```text
checkOut > checkIn
```

---

# 23. Money response

API nie powinno zwracać surowych floatów.

Preferowany DTO:

```json
{
  "amountMinor": 192000,
  "currency": "PLN"
}
```

Jeżeli frontend ma własny formatter, użyj go.

Źródłem prawdy jest:

```text
amountMinor + currency
```

---

# 24. Search endpoint

Zaimplementuj:

```http
GET /api/search
```

Obsługiwane params co najmniej:

```text
destination
checkIn
checkOut
adults
children
propertyType
pool
parking
maxPrice
minRating
sort
```

Dodatkowo przygotuj obsługę:

```text
north
south
east
west
```

dla filtrowania po aktualnym viewport mapy.

---

# 25. Semantyka maxPrice

Jeżeli podano:

```text
checkIn + checkOut
```

to:

```text
maxPrice
```

oznacza:

> maksymalną cenę całkowitą Stay

a nie cenę za noc.

Jest to zgodne z zasadą:

```text
Total Price First
```

---

# 26. Guest count

Dla MVP:

```text
requiredGuests = adults + children
```

Property przechodzi filtr jeśli:

```text
maxGuests >= requiredGuests
```

---

# 27. Amenity filters

Parametry:

```text
pool=true
parking=true
```

mapuj odpowiednio na:

```text
POOL
PARKING
```

Zaprojektuj SearchFilters w sposób pozwalający później przejść do:

```text
amenities=POOL,PARKING
```

bez przepisywania logiki domenowej.

---

# 28. Search sorting

Obsłuż:

```text
RECOMMENDED
LOWEST_PRICE
HIGHEST_RATING
CLOSEST_TO_BEACH
BEST_VALUE
```

Na MVP:

### RECOMMENDED

Prosty deterministic score.

Może uwzględniać:

```text
rating
saving
price
```

Nie przesadzaj z formułą.

Udokumentuj ją.

### LOWEST_PRICE

Sortuje po:

```text
totalAmount
```

jeżeli Stay jest znany.

### HIGHEST_RATING

```text
rating DESC
reviewCount DESC
```

### CLOSEST_TO_BEACH

Properties z `distanceToBeachMeters != null` pierwsze.

### BEST_VALUE

Prosty jawny ranking, np.:

```text
rating + relative saving
```

Nie używaj przypadkowego sortowania.

---

# 29. Search response

Przykładowy response:

```json
{
  "items": [
    {
      "id": "01J...",
      "slug": "baltic-loft-gdansk",
      "title": "Baltic Loft",
      "city": "Gdańsk",
      "district": "Brzeźno",

      "latitude": 54.4,
      "longitude": 18.6,

      "coverImage": {
        "url": "...",
        "altText": "..."
      },

      "rating": 9.4,
      "reviewCount": 127,

      "bedrooms": 2,
      "beds": 2,
      "bathrooms": 1,
      "maxGuests": 4,

      "propertyType": "APARTMENT",

      "amenities": [
        "POOL",
        "PARKING"
      ],

      "distanceToBeachMeters": 280,

      "price": {
        "nights": 4,
        "accommodationAmountMinor": 180000,
        "cleaningFeeAmountMinor": 12000,
        "totalAmountMinor": 192000,
        "marketAmountMinor": 210000,
        "savingAmountMinor": 18000,
        "currency": "PLN"
      }
    }
  ],
  "total": 18
}
```

Nie wystawiaj struktury bazy danych 1:1.

API ma mieć własne DTO.

---

# 30. Property endpoints

Zaimplementuj endpoint szczegółów Property.

Preferowany kontrakt:

```http
GET /api/properties/:slug
```

Opcjonalne query:

```text
checkIn
checkOut
adults
children
```

Property detail response powinien zawierać:

- wszystkie obrazy;
- pełny opis;
- amenities;
- geo;
- capacity;
- rating;
- pricing;
- PriceQuote, jeśli przekazano checkIn/checkOut.

Slug jest publicznym routingiem.

ID pozostaje tożsamością domenową.

---

# 31. Health endpoint

Dodaj:

```http
GET /api/health
```

Response przy poprawnym stanie:

```json
{
  "status": "ok"
}
```

Health powinien zweryfikować połączenie z PostgreSQL.

Jeśli DB jest niedostępna:

```text
non-2xx
```

---

# 32. OpenAPI

NestJS ma generować:

```text
/api/docs
```

Swagger UI.

Oraz raw spec:

```text
/api/openapi.json
```

Wszystkie publiczne endpointy mają:

- DTO;
- opisy parametrów;
- response schema.

---

# 33. API client dla frontend

Nie współdziel encji Drizzle/backendowych z frontendem.

Przepływ:

```text
Backend Domain/DB
      ↓
API DTO
      ↓
OpenAPI
      ↓
Frontend API Client
```

Utwórz:

```text
packages/api-client
```

Preferowane:

- wygenerowane TypeScript types z OpenAPI;
- prosty typed fetch client.

Nie buduj skomplikowanego SDK.

Nie importuj kodu backendowego do Next.js.

---

# 34. Frontend migration from mocks

Znajdź aktualne źródło mock data, np.:

```text
data/properties.ts
```

Nie usuwaj go przed przygotowaniem seeda.

Wykorzystaj istniejące dane do seeda PostgreSQL.

Po migracji:

```text
/search
```

ma pobierać wyniki z:

```text
GET /api/search
```

a:

```text
/property/[id]
```

ma pobierać dane z Property API.

Jeżeli obecny route korzysta z ID zamiast slug, zachowaj route bez redesignu i wykonaj mapowanie zgodne z aktualną aplikacją.

---

# 35. Nie zmieniaj UX podczas podłączania API

Obecne zachowanie musi pozostać:

- filters;
- sorting;
- map/list synchronization;
- marker selection;
- property detail page;
- total price presentation;
- saving badge;
- responsive behavior.

Jeżeli dotychczas część filtering była robiona frontendowo, przenieś canonical filtering na backend.

Frontend może nadal posiadać local UI state, ale źródłem wyników ma być API.

---

# 36. Loading state

Ponieważ dane będą teraz ładowane przez HTTP, dodaj estetyczne loading states zgodne z obecnym designem.

Preferuj skeletony zamiast pełnoekranowego spinnera.

Nie powoduj dużego layout shift.

---

# 37. Error state

Jeżeli API jest niedostępne:

- pokaż czytelny error state;
- nie crashuj całej strony;
- pozwól wykonać Retry.

Nie fallbackuj po cichu do mocków.

Chcemy od razu zauważyć problem backendu.

---

# 38. Empty state

Backend:

```text
items=[]
total=0
```

nie jest błędem.

Zachowaj istniejący empty state UI.

---

# 39. Seed data

Seed powinien:

1. utworzyć Host;
2. utworzyć amenities;
3. zaimportować obecne demo Properties;
4. zaimportować obrazy;
5. odwzorować ratings;
6. odwzorować pricing;
7. odwzorować location;
8. ustawić `PUBLISHED`.

Komenda:

```bash
pnpm db:seed
```

powinna być idempotentna dla local development.

Nie utrzymuj dwóch niezależnych zestawów danych demo.

---

# 40. Migration strategy

Schema changes wykonuj przez migracje.

Nie traktuj bezpośredniego `schema push` jako docelowej strategii.

Development ma wspierać:

```bash
pnpm db:migrate
```

---

# 41. Database indexes

Dodaj minimum:

```text
properties.slug UNIQUE
properties.status
properties.city
properties.property_type

property_images(property_id, position)

property_amenities(property_id)
property_amenities(amenity_id)
```

Geo:

```text
GiST index
```

FTS:

```text
GIN index
```

Trigram:

tylko dla pól faktycznie wykorzystywanych do fuzzy search.

Nie twórz indeksów „na zapas”.

---

# 42. Database constraints

Minimum:

```text
max_guests > 0
bedrooms >= 0
beds >= 0
bathrooms >= 0

rating >= 0
rating <= 10

review_count >= 0

base_daily_rate_amount_minor >= 0
cleaning_fee_amount_minor >= 0

market_daily_rate_amount_minor >= 0 OR NULL

distance_to_beach_meters >= 0 OR NULL
```

Foreign keys mają być realne.

---

# 43. Input validation

Wszystkie query params waliduj na backendzie.

Przykłady:

```text
adults >= 1
children >= 0
maxPrice >= 0
minRating 0..10
checkOut > checkIn
```

Nie zakładaj, że frontend wysyła poprawne wartości.

Invalid request:

```text
400 Bad Request
```

---

# 44. CORS

Development:

```text
http://localhost:3000
```

może wywoływać:

```text
http://localhost:3001
```

Origin konfiguruj przez env.

Nie ustawiaj globalnie `*` bez potrzeby.

---

# 45. Environment

Dodaj:

```text
.env.example
```

Minimum:

```env
DATABASE_URL=postgresql://rezervio:rezervio@localhost:5432/rezervio
API_PORT=3001
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

Jeżeli Next.js może wykonywać server-side requests bez publicznego URL, wykorzystaj bezpieczniejszą konfigurację.

---

# 46. Logging

Backend używa structured logging.

Loguj co najmniej:

```text
request completed
request failed
database connection error
search executed
```

Nie loguj sekretów.

---

# 47. Security baseline

Na tym etapie:

- security headers;
- sane request limits;
- input validation;
- env secrets;
- brak credentials w repo;
- production errors bez stack trace.

Nie implementuj jeszcze auth.

---

# 48. Tests — pricing

Dodaj testy:

```text
calculatePriceQuote
```

Scenariusze:

```text
4 nights
cleaning fee
market price
saving
no market price
invalid date range
```

---

# 49. Tests — search

Minimum:

- destination filter;
- guest capacity;
- pool;
- parking;
- max total price;
- min rating;
- sorting lowest price;
- sorting highest rating;
- viewport bounds;
- only PUBLISHED Property.

Preferuj integration tests tam, gdzie zachowanie zależy od PostgreSQL.

---

# 50. API smoke/e2e tests

Dodaj testy:

```text
GET /api/health
GET /api/search
GET /api/properties/:slug
```

Sprawdź status i podstawowy response shape.

---

# 51. Existing tests

Nie usuwaj obecnych frontendowych testów.

Dostosuj tylko to, co wymaga zmiany źródła danych.

---

# 52. Podman / OCI Compose

Minimum:

```text
db
```

Preferowany lokalny runtime:

```text
Podman
```

Najważniejsze:

```bash
podman compose up -d db
```

ma uruchamiać gotową bazę.

Jeżeli środowisko używa `podman-compose`, dokumentacja może podać równoważną komendę:

```bash
podman-compose up -d db
```

Plik Compose powinien pozostać zgodny ze standardowym formatem Compose/OCI i nie powinien używać funkcji wymagających Docker Desktop.

Preferowana nazwa pliku:

```text
compose.yml
```

Dodaj DB healthcheck.

Nie konteneryzuj Next.js i NestJS tylko dla lokalnego developmentu, jeśli nie jest to potrzebne. Preferowany local dev:

```text
Next.js  -> lokalny Node.js / pnpm
NestJS   -> lokalny Node.js / pnpm
Postgres -> Podman
```

W przyszłości Redis może zostać dodany jako kolejny serwis infrastrukturalny uruchamiany przez Podmana.

---

# 53. Developer experience

Docelowa ścieżka:

```bash
git clone ...
cd rezervio

pnpm install

podman machine start   # tylko jeśli wymagane na macOS
podman compose up -d db

pnpm db:migrate
pnpm db:seed

pnpm dev
```

Następnie:

```text
Web:     http://localhost:3000
API:     http://localhost:3001/api
Swagger: http://localhost:3001/api/docs
```

---

# 54. README

Zaktualizuj README.

Opisz:

- architekturę;
- wymagania;
- informację, że **Podman jest preferowanym lokalnym container runtime**;
- setup `podman machine` na macOS, jeśli jest potrzebny;
- local setup;
- migrations;
- seed;
- web URL;
- API URL;
- Swagger URL;
- test commands;
- strukturę repo.

README ma być praktyczne i krótkie.

---

# 55. Architecture note

Dodaj:

```text
docs/architecture.md
```

Minimum:

```text
Next.js = presentation/web
NestJS = application API
PostgreSQL = transactional source of truth
PostGIS = geo
PostgreSQL FTS + pg_trgm = current search
pgvector = future semantic search foundation
```

Zapisz:

> PostgreSQL jest obecnie zarówno source of truth, jak i search backendem MVP.

Oraz:

> Jeżeli search stanie się niezależnym problemem skalowania/rankingu, może zostać później wydzielony do Vespa/OpenSearch bez zmiany transactional source of truth.

---

# 56. No DB access from frontend

Next.js frontend nie może łączyć się bezpośrednio z PostgreSQL.

Poprawny przepływ:

```text
web
 ↓
REST API
 ↓
api
 ↓
PostgreSQL
```

Nie:

```text
web
 ↓
Drizzle
 ↓
PostgreSQL
```

---

# 57. Stateless backend

NestJS nie może przechowywać krytycznego stanu w memory.

API ma być stateless i gotowe do uruchomienia wielu instancji w przyszłości.

---

# 58. API DTO != DB entity

Nie wystawiaj rekordów Drizzle 1:1.

Przepływ:

```text
DB record
  ↓
mapper/application
  ↓
API DTO
```

Nie buduj przy tym przesadnie złożonego DDD.

---

# 59. No abstraction theater

Nie twórz bez potrzeby:

```text
IRepository<T>
BaseRepository<T>
GenericCrudService<T>
```

Preferuj konkretne i czytelne rozwiązania.

---

# 60. Search runs in PostgreSQL

Nie pobieraj wszystkich Property do Node.js w celu filtrowania.

Filtering, sorting, fuzzy search i geo powinny wykonywać się w PostgreSQL.

---

# 61. Search performance sanity check

Po seedzie sprawdź reprezentatywne query przez:

```text
EXPLAIN ANALYZE
```

Nie optymalizuj przedwcześnie.

Upewnij się tylko, że używane są sensowne indeksy.

---

# 62. URL state

Zachowaj aktualną zasadę:

```text
/search?destination=...
```

Filtry są reprezentowane w URL.

Reload strony nie resetuje stanu.

Request do backendu jest deterministycznie tworzony na podstawie query params.

---

# 63. Dates

API używa:

```text
YYYY-MM-DD
```

dla:

```text
checkIn
checkOut
```

Nie wysyłaj timestampów dla dat Stay.

---

# 64. Bezpieczna migracja mock data

Proces:

```text
1. inspect current mock data
2. implement DB schema
3. implement seed
4. seed DB
5. implement API
6. connect frontend
7. verify visual/functional parity
8. remove runtime dependency on mocks
```

Jeżeli mock jest źródłem seeda, przenieś go do backendowego seed package i pozostaw jedną kopię.

---

# 65. Visual sanity check

Po migracji sprawdź:

```text
/
 /search
 /property/[id]
```

na desktop i mobile.

Milestone nie może przypadkowo zmienić:

- kolorów;
- zdjęć;
- kart;
- mapy;
- cen demo;
- badge;
- responsywności.

---

# 66. Definition of Done

Milestone jest ukończony dopiero, gdy:

## Repo

- pnpm workspace działa;
- frontend działa;
- backend NestJS istnieje.

## Backend

- NestJS działa na Fastify;
- `/api/health` działa;
- Swagger działa;
- `/api/search` działa;
- Property detail API działa.

## Database

- PostgreSQL uruchamia się przez Podman/OCI Compose;
- PostGIS aktywne;
- pg_trgm aktywne;
- pgvector aktywne;
- migrations działają;
- seed działa;
- demo Property są w DB.

## Frontend

- runtime nie korzysta już z mocków jako source of truth;
- search pobiera z API;
- detail pobiera z API;
- filtry działają;
- sort działa;
- map/list sync działa;
- total price działa;
- saving działa;
- mobile działa.

## Quality

Muszą przejść:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## DB lifecycle

Muszą działać:

```bash
podman compose up -d db
pnpm db:migrate
pnpm db:seed
```

---

# 67. Full verification

Po implementacji wykonaj, jeśli bezpieczne lokalnie:

```bash
podman compose down -v
podman compose up -d db

pnpm db:migrate
pnpm db:seed

pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Potem:

```bash
pnpm dev
```

Zweryfikuj:

```text
http://localhost:3000
http://localhost:3000/search
http://localhost:3001/api/health
http://localhost:3001/api/docs
```

---

# 68. Nie kończ w połowie

Nie pozostawiaj stanu:

```text
API gotowe, frontend nadal używa mocków
```

albo:

```text
schema gotowa, seed nie działa
```

Milestone ma być działającym vertical slice:

```text
PostgreSQL
   ↓
NestJS API
   ↓
Next.js
   ↓
existing Rezervio UI
```

---

# 69. Raport końcowy agenta

Po zakończeniu wypisz:

## Implemented

Krótko:

- monorepo;
- NestJS/Fastify;
- PostgreSQL/extensions;
- Drizzle/migrations;
- seed;
- API;
- frontend integration;
- OpenAPI;
- tests.

## Commands

Podaj dokładne komendy:

```text
install
Podman machine start (jeśli potrzebne)
db start
migrate
seed
dev
test
build
```

## Verification

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
tests: PASS/FAIL
build: PASS/FAIL
```

## Important decisions

Maksymalnie 5 istotnych decyzji technicznych.

## Next milestone

Nie implementuj go.

Tylko wskaż:

> **Milestone 02: Host Property Management — create/edit/publish Property + image upload.**

---

# 70. Final principle

Po zakończeniu użytkownik ma zobaczyć **ten sam Rezervio**, ale pod spodem:

```text
mock data
```

ma zostać zastąpione przez:

```text
PostgreSQL
+
NestJS/Fastify
+
REST API
```

To jest główny cel tego milestone.
