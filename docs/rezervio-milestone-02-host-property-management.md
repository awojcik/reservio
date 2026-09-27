# Rezervio — Milestone 02: Host Property Management

> Cel: umożliwić prawdziwemu Hostowi założenie konta, utworzenie Property, edycję danych, dodanie zdjęć, podgląd oraz publikację tak, aby Property pojawiło się w publicznym Search.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01.

Najpierw:

1. przeanalizuj aktualną strukturę repo;
2. uruchom istniejące testy;
3. przeczytaj:
   - `docs/domain-language.md`
   - `docs/architecture.md`
   - `docs/milestone-01-backend-foundation.md`
4. dopiero potem rozpocznij implementację.

Nie zakładaj, że repo wygląda dokładnie jak w tym dokumencie. Dostosuj implementację do realnego kodu.

Terminologia z `docs/domain-language.md` jest wiążąca.

Używamy:

```text
User
Host
Guest
Property
Listing
Amenity
DailyRate
```

Nie wprowadzaj bez potrzeby:

```text
Customer
Owner
Landlord
Offer
Accommodation
Reservation
RentalObject
```

---

# 1. Aktualny stack

Zakładamy:

```text
Frontend:       Next.js + React + TypeScript
Backend:        NestJS + Fas
Database:       PostgreSQL
ORM:            Drizzle ORM
Geo:            PostGIS
Search:         PostgreSQL FTS + pg_trgm
Vector future:  pgvector
Local infra:    Podman / OCI Compose
Package mgr:    pnpm
Architecture:   Modular Monolith
API:            REST + OpenAPI
```

Nie zmieniaj stacku bez bardzo mocnego powodu.

---

# 2. Główny rezultat biznesowy

Po zakończeniu musi działać:

```text
Host
 ↓
Register / Login
 ↓
Host Dashboard
 ↓
Create Property
 ↓
Edit details
 ↓
Set location
 ↓
Select amenities
 ↓
Upload images
 ↓
Set price
 ↓
Preview
 ↓
Publish
 ↓
Public Search
 ↓
Guest widzi nowe Property
```

Po tym milestone Rezervio ma nadawać się do onboardingu pierwszego realnego Host.

---

# 3. Zakres

Zaimplementuj:

- User authentication;
- Host profile;
- server-side sessions;
- Host authorization;
- Host dashboard;
- listę Property Host;
- Create Property;
- Edit Property;
- lokalizację;
- capacity;
- amenities;
- pricing MVP;
- image upload;
- image delete;
- image reorder;
- preview;
- publish readiness;
- publish;
- unpublish;
- archive;
- integrację z publicznym Search;
- integrację z publicznym Property detail;
- OpenAPI;
- testy;
- lokalny S3-compatible storage przez Podman;
- aktualizację README/docs.

---

# 4. Poza zakresem

Nie implementuj:

```text
Booking
BookingHold
Availability Calendar
manual availability blocks
iCal
PMS
Payments
Refunds
Payouts
KYC
Reviews
Messaging
AI
semantic/vector search
dynamic pricing
promotions
admin dashboard
co-host permissions
social login
MFA
password reset
email verification flow
guest account
```

Nie rozszerzaj milestone o Availability ani Booking.

---

# 5. Architektura

Pozostajemy przy:

```text
Modular Monolith
```

Nie twórz mikroserwisów.

Docelowo:

```text
Next.js
   ↓
NestJS REST API
   ↓
PostgreSQL
```

Dla obrazów:

```text
Browser
   ↓ presigned upload
S3-compatible Object Storage
```

---

# 6. Backend modules

Dodaj tylko realnie potrzebne:

```text
src/modules/
├── auth/
├── users/
├── hosts/
├── properties/
├── amenities/
├── storage/
├── search/
└── health/
```

Nie twórz pustych modułów na przyszłość.

---

# 7. Authentication

Na MVP:

```text
email + password
```

Identity:

```text
User
```

Host jest profilem powiązanym z User.

Nie twórz osobnego `HostAccount`.

---

# 8. User model

Tabela:

```text
users
```

Pola:

```text
id
email
password_hash
created_at
updated_at
```

Constraint:

```text
email UNIQUE
```

Email:

```text
trim
lowercase
validate
```

Nie przechowuj plain password.

---

# 9. Password hashing

Użyj:

```text
Argon2id
```

Preferowana biblioteka:

```text
argon2
```

Minimum:

```text
10 znaków
```

Nie używaj własnego schematu hashującego.

---

# 10. Sesje

Na MVP użyj opaque server-side sessions.

Flow:

```text
Browser
 ↓ HttpOnly cookie
random session token
 ↓
NestJS
 ↓
session lookup
 ↓
PostgreSQL
```

W DB przechowuj hash tokena, nie raw token.

Nie używaj `localStorage` ani `sessionStorage` do auth.

---

# 11. user_sessions

Tabela:

```text
user_sessions
```

Pola:

```text
id
user_id
token_hash
expires_at
created_at
last_seen_at nullable
```

Indexes:

```text
token_hash UNIQUE
user_id
expires_at
```

Token ma mieć minimum 32 bytes losowej entropii.

---

# 12. Session cookie

Nazwa np.:

```text
rezervio_session
```

Parametry:

```text
HttpOnly=true
SameSite=Lax
Path=/
Secure=true in production
```

Localhost:

```text
Secure=false
```

TTL MVP:

```text
7 dni
```

---

# 13. Auth API

Zaimplementuj:

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Register tworzy w jednej lokalnej transakcji:

```text
User
Host
UserSession
```

---

# 14. Register

Request:

```json
{
  "displayName": "Anna Kowalska",
  "email": "anna@example.com",
  "password": "very-secure-password"
}
```

Po sukcesie:

- User istnieje;
- Host istnieje;
- sesja jest ustawiona;
- frontend przechodzi do `/host`.

---

# 15. Login

Nie ujawniaj, czy email istnieje.

Komunikat:

```text
Nieprawidłowy email lub hasło.
```

Dodaj prosty rate limiting dla login/register.

---

# 16. Logout

`POST /api/auth/logout`:

- unieważnia sesję w DB;
- czyści cookie;
- jest bezpieczny przy retry.

---

# 17. Host model

Rozszerz istniejącą tabelę `hosts`.

Minimum:

```text
id
user_id
display_name
created_at
updated_at
```

Constraint:

```text
user_id UNIQUE
```

Na MVP:

```text
User 1 -> 0..1 Host
```

---

# 18. Host authorization

Wszystkie:

```text
/api/host/*
```

wymagają:

```text
valid session
+
Host profile
```

Nie ufaj `hostId` przesłanemu przez klienta.

Host identity:

```text
Session → User → Host
```

---

# 19. Ownership invariant

Host może czytać i modyfikować tylko własne Property.

Backend sprawdza:

```text
property.host_id == authenticatedHost.id
```

Dotyczy:

- GET;
- PATCH;
- publish;
- unpublish;
- archive;
- preview;
- image upload;
- image delete;
- image reorder.

Dla cudzego Property preferuj:

```text
404
```

aby nie ujawniać jego istnienia.

---

# 20. Host routes frontend

Dodaj:

```text
/host/login
/host/register
/host
/host/properties
/host/properties/new
/host/properties/[id]
/host/properties/[id]/preview
```

Niezalogowany User próbujący wejść pod `/host/*` ma trafić do `/host/login`.

---

# 21. Design Host area

Użyj istniejącego design language Rezervio.

Zachowaj:

```text
Deep Pine
Coral
Cream
existing typography
existing radiuses
existing spacing
```

Nie twórz osobnego design systemu ani nowych przypadkowych kolorów.

---

# 22. Host dashboard

`/host`

Minimum:

```text
Twoje obiekty

3 obiekty
2 opublikowane
1 draft

[ Dodaj obiekt ]
```

Nie dodawaj teraz statystyk przychodów, occupancy czy payoutów.

---

# 23. Property list

`/host/properties`

Item:

```text
cover image
title
city
status
baseDailyRate
updatedAt
```

Actions:

```text
Edit
Preview
Publish / Unpublish
Archive
```

Statusy MVP:

```text
DRAFT
PUBLISHED
SUSPENDED
ARCHIVED
```

---

# 24. Create Property

`/host/properties/new`

Nowe Property:

```text
status = DRAFT
```

Draft może być niekompletny.

Po utworzeniu przejdź do:

```text
/host/properties/[id]
```

---

# 25. Property editor

Preferowane sekcje:

```text
1. Podstawowe informacje
2. Lokalizacja
3. Parametry
4. Udogodnienia
5. Zdjęcia
6. Cena
7. Publikacja
```

Może to być jedna strona z sekcjami albo wizard.

Preferuj prostotę.

---

# 26. Basic fields

Edytowalne:

```text
title
description
propertyType
```

Publish validation:

```text
title required, 5..120
description required, 80..5000
```

DRAFT może być niekompletny.

---

# 27. Property type

Canonical:

```text
APARTMENT
HOUSE
VILLA
STUDIO
```

UI może tłumaczyć je na polski.

---

# 28. Location

Rozszerz Property o:

```text
address_line1
postal_code
city
district
country_code
time_zone
latitude
longitude
```

Nie hardcoduj PL w domenie.

UI może defaultować do:

```text
PL
```

---

# 29. Address privacy

Publiczne API nie może automatycznie ujawniać:

```text
addressLine1
postalCode
```

Publicznie wystarczą:

```text
city
district
public/approx map location zgodna z obecnym UX
```

---

# 30. Map picker

W editorze użyj istniejącego MapLibre.

Host powinien móc:

- wpisać adres;
- wskazać/przesunąć marker;
- zapisać lat/lon.

Nie dodawaj Google Maps tylko dla tego formularza.

Geocoding/autocomplete nie jest wymagany.

---

# 31. Capacity

Pola:

```text
maxGuests
bedrooms
beds
bathrooms
```

Validation:

```text
maxGuests >= 1
bedrooms >= 0
beds >= 0
bathrooms >= 0
```

Publish:

```text
maxGuests >= 1
beds >= 1
bathrooms >= 1
```

---

# 32. Amenities

Host wybiera co najmniej:

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

Dodaj:

```http
GET /api/amenities
```

jeśli to upraszcza frontend.

Lista ma mieć jeden source of truth.

---

# 33. Pricing MVP

Host edytuje:

```text
baseDailyRate
cleaningFee
currency
```

UI:

```text
450 zł
```

Persistence/API source of truth:

```text
45000 + PLN
```

Nigdy float dla Money.

---

# 34. MarketPrice

Host nie ustawia MarketPrice jako „ceny konkurencji”.

Jeżeli pole z Milestone 01 istnieje, zachowaj kompatybilność, ale nie pokazuj go w Host editor.

---

# 35. Host Property API

Zaimplementuj:

```http
GET    /api/host/properties
POST   /api/host/properties
GET    /api/host/properties/:id
PATCH  /api/host/properties/:id

POST   /api/host/properties/:id/publish
POST   /api/host/properties/:id/unpublish
POST   /api/host/properties/:id/archive
```

PATCH nie może zmieniać:

```text
hostId
status
createdAt
updatedAt
```

---

# 36. Partial updates

Draft można zapisywać częściowo.

Nie wymagaj publish completeness przy zwykłym PATCH.

---

# 37. Publish jako domain command

Publikacja:

```http
POST /api/host/properties/:id/publish
```

Flow:

```text
load
→ ownership
→ publish validation
→ status=PUBLISHED
→ commit
```

Nie rób `PATCH status=PUBLISHED`.

---

# 38. Publish requirements

Minimum:

```text
title valid
description valid
propertyType set

countryCode
city
latitude
longitude
timeZone

maxGuests >= 1
beds >= 1
bathrooms >= 1

baseDailyRate > 0
currency valid

minimum 3 PropertyImage
```

Amenities nie są obowiązkowe.

CleaningFee może być 0.

---

# 39. Publish readiness

Host DTO ma zawierać:

```json
{
  "publishReadiness": {
    "ready": false,
    "missing": [
      "DESCRIPTION",
      "LOCATION",
      "MINIMUM_IMAGES"
    ]
  }
}
```

Backend jest source of truth dla reguł publish.

---

# 40. Publish failure

Niekompletne Property:

```text
422 Unprocessable Entity
```

Przykład:

```json
{
  "code": "PROPERTY_NOT_READY_FOR_PUBLISH",
  "errors": [
    {
      "field": "images",
      "code": "MINIMUM_IMAGES_REQUIRED",
      "required": 3
    }
  ]
}
```

---

# 41. Unpublish

```http
POST /api/host/properties/:id/unpublish
```

Transition:

```text
PUBLISHED → SUSPENDED
```

SUSPENDED znika z publicznego Search.

---

# 42. Archive

```http
POST /api/host/properties/:id/archive
```

Ustaw:

```text
ARCHIVED
```

Nie hard-delete.

---

# 43. Slug

Property ma:

```text
id
slug
```

Przykład:

```text
apartament-nad-morzem-gdansk
```

Slug musi być unique.

Collision:

```text
...-2
```

Po pierwszym publish slug powinien być stabilny.

---

# 44. Preview

Route:

```text
/host/properties/[id]/preview
```

Preview działa dla:

```text
DRAFT
SUSPENDED
PUBLISHED
```

Wymaga ownership.

Nie wystawiaj DRAFT przez publiczne API.

---

# 45. Reuse UI

Preview ma używać tych samych komponentów prezentacyjnych co publiczne Property detail.

Nie utrzymuj dwóch niezależnych implementacji.

---

# 46. Object storage

Zdjęcia przechowujemy w:

```text
S3-compatible Object Storage
```

Nie w PostgreSQL jako blob.

Flow:

```text
Browser
 ↓ request upload URL
NestJS
 ↓ presigned URL
Browser
 ↓ direct upload
Object Storage
 ↓ confirm metadata
NestJS
 ↓
PropertyImage in PostgreSQL
```

---

# 47. Local storage

Lokalnie użyj:

```text
MinIO
```

lub równoważnego lekkiego S3-compatible storage uruchamianego przez Podman.

`compose.yml` powinien mieć:

```text
db
object-storage
```

Nie wymagaj Docker Desktop.

---

# 48. Production compatibility

Storage ma być kompatybilny z DigitalOcean Spaces.

Env:

```env
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=
S3_PUBLIC_BASE_URL=
```

Nie hardcoduj MinIO w domenie.

---

# 49. Storage abstraction

Prosta abstrakcja:

```ts
interface ObjectStorage {
  createPresignedUpload(...): Promise<...>
  deleteObject(...): Promise<void>
  getPublicUrl(...): string
}
```

Implementacja np.:

```text
S3ObjectStorage
```

Bez generic frameworków.

---

# 50. Upload URL

Endpoint:

```http
POST /api/host/properties/:id/images/upload-url
```

Request:

```json
{
  "fileName": "living-room.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 2450000
}
```

Response:

```json
{
  "uploadUrl": "...",
  "objectKey": "properties/.../....jpg",
  "expiresInSeconds": 600
}
```

---

# 51. Confirm image

Po uploadzie:

```http
POST /api/host/properties/:id/images
```

Body:

```json
{
  "objectKey": "properties/.../....jpg",
  "altText": "Salon apartamentu"
}
```

Backend musi zweryfikować, że objectKey należy do tego flow/Property.

---

# 52. Image validation

Allowed:

```text
image/jpeg
image/png
image/webp
```

Max:

```text
10 MB/image
30 images/Property
```

Walidacja server-side.

---

# 53. Object key

Np.:

```text
properties/{propertyId}/{uuid}.{ext}
```

Nie używaj oryginalnej nazwy jako finalnego klucza.

---

# 54. PropertyImage

Minimum:

```text
id
property_id
object_key
url nullable
alt_text
position
created_at
```

`object_key` jest source of truth dla operacji storage.

---

# 55. Reorder images

Endpoint:

```http
PUT /api/host/properties/:id/images/order
```

Body:

```json
{
  "imageIds": ["...", "...", "..."]
}
```

Backend sprawdza:

```text
ownership
same Property
no duplicates
all IDs valid
```

Zmiana kolejności ma być transakcyjna.

---

# 56. Cover image

Na MVP:

```text
position = 0
```

oznacza cover.

---

# 57. Delete image

```http
DELETE /api/host/properties/:id/images/:imageId
```

Operacja ma być retry-safe.

Po usunięciu uporządkuj `position`.

Nie pozwól, aby przejściowy błąd storage uszkodził stan biznesowy Property.

---

# 58. Image UX

Host UI:

```text
drag & drop
upload progress
thumbnails
drag reorder
delete
cover badge
```

Nie implementuj crop/AI enhancement.

---

# 59. Host Property DTO

Przykład:

```json
{
  "id": "...",
  "slug": "...",
  "status": "DRAFT",
  "title": "...",
  "description": "...",
  "propertyType": "APARTMENT",
  "address": {
    "addressLine1": "...",
    "postalCode": "...",
    "city": "...",
    "district": "...",
    "countryCode": "PL",
    "latitude": 52.1,
    "longitude": 21.0,
    "timeZone": "Europe/Warsaw"
  },
  "capacity": {
    "maxGuests": 4,
    "bedrooms": 2,
    "beds": 2,
    "bathrooms": 1
  },
  "amenities": ["WIFI", "PARKING"],
  "pricing": {
    "baseDailyRateAmountMinor": 45000,
    "cleaningFeeAmountMinor": 10000,
    "currency": "PLN"
  },
  "images": [],
  "publishReadiness": {
    "ready": false,
    "missing": ["MINIMUM_IMAGES"]
  }
}
```

Nie wystawiaj DB record 1:1.

---

# 60. Public Search integration

Po:

```text
status=PUBLISHED
```

Property musi pojawić się w:

```http
GET /api/search
```

bez seeda, reindexu i restartu.

Po:

```text
PUBLISHED → SUSPENDED
```

ma zniknąć.

---

# 61. Public Property detail

PUBLISHED Property działa pod aktualnym publicznym routingiem.

Dla:

```text
DRAFT
SUSPENDED
ARCHIVED
```

public API zwraca:

```text
404
```

---

# 62. Frontend auth state

Źródło prawdy:

```http
GET /api/auth/me
```

Frontend nie odczytuje cookie i nie dekoduje tokena.

---

# 63. CORS + cookies

Development:

```text
web=http://localhost:3000
api=http://localhost:3001
```

Konfiguracja:

```text
credentials=true
explicit allowed origin
```

Nie używaj wildcard `*` z credentials.

---

# 64. Transactions

Użyj transakcji dla:

```text
register User + Host + Session
amenities replacement
image reorder
publish transition
```

Nie trzymaj transakcji DB podczas network call do object storage.

---

# 65. Validation

Backend waliduje wszystko:

```text
title
description
propertyType
countryCode
lat/lon
capacity
money
MIME
size
ownership
```

Frontend validation poprawia UX, ale nie jest security boundary.

---

# 66. Migrations

Zmiany schema wykonuj przez Drizzle migrations.

Dodaj migracje dla:

```text
users
user_sessions
hosts.user_id
address fields
property_images.object_key
pozostałych wymaganych pól/indexów
```

---

# 67. Seed compatibility

Istniejące demo data mają nadal działać.

Jeśli demo Host nie ma User, dodaj lokalne demo konto i powiąż je z Host.

README może zawierać development-only credentials.

---

# 68. Podman / infra

Preferowany workflow:

```bash
podman machine start   # jeśli potrzebne na macOS
pnpm infra:start
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Dodaj:

```text
pnpm infra:start
pnpm infra:stop
pnpm infra:reset
```

które korzystają z Podman Compose.

Nie wymagaj Docker Desktop.

---

# 69. .env.example

Rozszerz o:

```env
DATABASE_URL=postgresql://rezervio:rezervio@localhost:5432/rezervio

API_PORT=3001
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001/api

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

Nie commituj produkcyjnych sekretów.

---

# 70. OpenAPI

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Dodaj wszystkie nowe auth/host/image endpointy i response schemas.

---

# 71. API client

Jeżeli Milestone 01 generuje typed client z OpenAPI:

- regeneruj go;
- nie twórz drugiego zestawu ręcznych typów.

Frontend nie importuje DB entities.

---

# 72. Logging

Structured logs dla:

```text
auth.login.failed
auth.login.succeeded
property.created
property.updated
property.published
property.unpublished
property.archived
property.image.added
property.image.deleted
```

Nie loguj:

```text
password
session token
presigned URL
S3 secret
```

---

# 73. Tests — auth

Minimum:

```text
register creates User + Host + Session
duplicate email rejected
password is hashed
valid login works
invalid login fails
logout invalidates session
expired session rejected
auth/me works
```

---

# 74. Tests — authorization

Obowiązkowe:

```text
Host A can read own Property
Host A can edit own Property
Host A cannot read Host B Property
Host A cannot edit Host B Property
Host A cannot upload image to Host B Property
Host A cannot publish Host B Property
```

Preferuj integration/e2e tests.

---

# 75. Tests — Property lifecycle

Minimum:

```text
create -> DRAFT
partial update works
incomplete publish -> 422
complete publish -> PUBLISHED
published Property appears in Search
unpublish -> SUSPENDED
suspended Property disappears from Search
archive -> ARCHIVED
archived Property not public
```

---

# 76. Tests — images

Minimum:

```text
upload URL only for own Property
invalid MIME rejected
too large rejected
30 image limit
confirm ownership
reorder transactional
delete works
cover=position 0
foreign Property operation rejected
```

---

# 77. Manual end-to-end scenario

Wykonaj:

```text
1. Register new Host
2. Create Property
3. Save incomplete Draft
4. Verify Draft is not public
5. Fill basic information
6. Set location
7. Set capacity
8. Select amenities
9. Set price
10. Upload >= 3 images
11. Reorder images
12. Preview
13. Publish
14. Search as public Guest
15. Find new Property
16. Open Property detail
17. Unpublish
18. Verify it disappears from Search
19. Publish again
20. Archive
21. Verify it is no longer public
```

---

# 78. Quality gates

Muszą przejść:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Jeśli istnieje:

```bash
pnpm test:e2e
```

również ma przejść.

---

# 79. Clean setup verification

Jeśli bezpieczne lokalnie:

```bash
pnpm infra:stop
podman compose down -v

pnpm infra:start
pnpm db:migrate
pnpm db:seed

pnpm lint
pnpm typecheck
pnpm test
pnpm build

pnpm dev
```

Clean setup nie może wymagać ręcznego klikania w bazie ani MinIO.

---

# 80. Definition of Done

Milestone jest skończony dopiero, gdy:

### Auth

```text
register działa
login działa
logout działa
auth/me działa
password hash działa
HttpOnly session działa
session jest server-side
ownership jest egzekwowany
```

### Host

```text
dashboard działa
Property list działa
Create Draft działa
Edit działa
Preview działa
Publish działa
Unpublish działa
Archive działa
```

### Images

```text
local S3 storage działa pod Podmanem
presigned upload działa
upload progress działa
reorder działa
cover=position 0
delete działa
```

### Marketplace

```text
DRAFT not public
PUBLISHED public
new Property visible in Search
public detail works
SUSPENDED not public
ARCHIVED not public
```

### Quality

```text
lint PASS
typecheck PASS
tests PASS
build PASS
```

---

# 81. Dokumentacja

Zaktualizuj:

```text
README.md
docs/architecture.md
docs/domain-language.md jeśli pojawiły się nowe trwałe koncepty
.env.example
OpenAPI
```

README ma opisywać:

```text
Host register/login
demo Host account
Podman
object storage
infra:start
migrations
seed
development URLs
```

---

# 82. Nie kończ w połowie

Nie akceptuj stanu:

```text
Host tworzy Property, ale nie może publish
```

ani:

```text
upload działa, ale Search nie widzi Property
```

ani:

```text
frontend sprawdza ownership, backend nie
```

ani:

```text
DRAFT jest dostępny publicznie
```

To ma być vertical slice.

---

# 83. Raport końcowy agenta

Po zakończeniu podaj:

## Implemented

Krótko:

```text
auth
server-side sessions
Host profile
Host dashboard
Property CRUD
publish lifecycle
S3 storage
image upload
preview
public integration
tests
docs
```

## Database migrations

Wypisz dodane tabele/pola/indexy.

## API

Wypisz nowe endpointy.

## Commands

Podaj dokładnie:

```text
install
infra start
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
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual Host flow: PASS/FAIL
```

## Important decisions

Maksymalnie 5.

## Known limitations

Tylko realne ograniczenia.

## Next milestone

Nie implementuj go.

Wskaż wyłącznie:

> Milestone 03: Availability & Calendar — manual availability, date blocks, iCal import/export and synchronization.

---

# 84. Final principle

Po ukończeniu Milestone 02 Rezervio ma przestać być marketplace'em zasilanym wyłącznie seedami.

Musi być możliwe:

```text
real Host
  ↓
create Property
  ↓
upload photos
  ↓
publish
  ↓
real Guest
  ↓
find Property in Search
```

Nie implementuj jeszcze Availability, Booking ani Payments.
