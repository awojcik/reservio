# Rezervio — Milestone 03: Availability & Calendar

> Cel: zbudować wiarygodny model dostępności Property, kalendarz Host, ręczne blokady terminów oraz iCal import/export tak, aby publiczny Search zwracał wyłącznie Property dostępne dla wybranego Stay.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01 i 02.

Najpierw:
1. przeanalizuj aktualną strukturę repo;
2. uruchom istniejące testy;
3. przeczytaj:
   - `docs/domain-language.md`
   - `docs/architecture.md`
   - `docs/milestone-01-backend-foundation.md`
   - `docs/milestone-02-host-property-management.md`
4. dopiero potem rozpocznij implementację.

Nie zakładaj konkretnej struktury repo, jeśli realny kod wygląda inaczej.

Canonical terms:
`Property`, `Stay`, `Availability`, `AvailabilityBlock`, `ExternalCalendar`, `Host`, `Booking`, `BookingHold`.

W tym milestone nie implementujemy `Booking` ani `BookingHold`, ale model Availability ma być gotowy na ich późniejsze dodanie.

---

# 1. Aktualny stack

Zakładamy:

```text
Frontend:       Next.js + React + TypeScript
Backend:        NestJS + Fastify
Database:       PostgreSQL
ORM:            Drizzle ORM
Geo:            PostGIS
Search:         PostgreSQL FTS + pg_trgm
Auth:           server-side sessions
Object storage: S3-compatible
Local infra:    Podman / OCI Compose
Package mgr:    pnpm
Architecture:   Modular Monolith
API:            REST + OpenAPI
```

W tym milestone dokładamy:

```text
Redis
BullMQ
```

wyłącznie do background sync / retry / scheduling.

---

# 2. Główny rezultat biznesowy

Po ukończeniu musi działać:

```text
Host
 ↓
Property Calendar
 ↓
manual block
 ↓
Availability zmienia się
 ↓
Guest Search z checkIn/checkOut
 ↓
Property jest odfiltrowane
```

oraz:

```text
Host
 ↓
dodaje iCal URL z Booking/Airbnb/PMS
 ↓
Rezervio synchronizuje calendar
 ↓
external events blokują terminy
```

oraz:

```text
Host
 ↓
generuje Rezervio iCal export URL
 ↓
zewnętrzny system może importować blokady Rezervio
```

---

# 3. Zakres

Zaimplementuj:
- model `AvailabilityBlock`;
- ręczne Host blocks;
- ręczne unblock z obsługą split;
- Host calendar UI;
- public availability API;
- Search filtering po `checkIn/checkOut`;
- `ExternalCalendar`;
- szyfrowanie iCal import URL;
- bezpieczny iCal fetch;
- parser iCal;
- snapshot reconciliation;
- manual `Sync now`;
- automatic periodic sync;
- retry;
- sync status/errors;
- Redis + BullMQ;
- iCal export;
- revocable export token;
- Podman infra;
- OpenAPI;
- testy;
- dokumentację.

---

# 4. Poza zakresem

Nie implementuj:

```text
Booking
BookingHold
BookingRequest
Payment
Refund
Payout
PSP
native PMS API
Booking.com Connectivity API
Airbnb API
dynamic pricing
daily rate overrides
CalDAV
Google Calendar
Outlook Calendar
AI
semantic search
multi-room inventory
```

---

# 5. Availability jest backendowym invariantem

Publiczny Search dla:

```text
checkIn
checkOut
```

musi odfiltrować każde Property posiadające blokadę nachodzącą na Stay.

Nie pobieraj wyników i nie ukrywaj ich frontendowo.

PostgreSQL jest source of truth.

---

# 6. Half-open ranges

W całym systemie:

```text
[startDate, endDate)
```

Przykład:

```text
block [2026-09-12, 2026-09-16)
```

nie koliduje z:

```text
stay [2026-09-16, 2026-09-18)
```

`endDate` jest exclusive.

---

# 7. PostgreSQL daterange

Preferuj:

```text
daterange
```

dla `AvailabilityBlock`.

Overlap:

```sql
date_range && daterange(:startDate, :endDate, '[)')
```

Jeżeli Drizzle utrudnia range operators, użyj jawnego SQL.

---

# 8. availability_blocks

Dodaj tabelę:

```text
availability_blocks
```

Minimum:

```text
id
property_id
source_type
date_range
external_calendar_id nullable
external_event_uid nullable
note nullable
created_at
updated_at
```

Aktualne `source_type`:

```text
HOST_BLOCK
EXTERNAL_CALENDAR
```

Schema może być future-ready na:

```text
BOOKING
BOOKING_HOLD
MAINTENANCE
```

ale nie implementuj ich flow.

---

# 9. Invariants

Każdy block:
- ma istniejące Property;
- ma `lower(date_range) < upper(date_range)`;
- `EXTERNAL_CALENDAR` wymaga `external_calendar_id`;
- `HOST_BLOCK` nie może wskazywać external calendar.

Dodaj:
- FK;
- check constraints;
- B-tree index po `property_id`;
- GiST po `date_range`;
- index po `external_calendar_id`.

---

# 10. Canonical availability rule

```text
available =
  NOT EXISTS AvailabilityBlock
  overlapping requested Stay
```

Ta sama semantyka obowiązuje w:
- Search;
- public availability;
- Property detail;
- przyszłym Booking validation.

Nie twórz kilku różnych definicji overlap.

---

# 11. AvailabilityService

Dodaj:

```text
AvailabilityService
```

Minimum:

```text
isAvailable(propertyId, stay)
getAvailability(propertyId, range)
blockDates(...)
unblockDates(...)
```

---

# 12. Manual block

Endpoint:

```http
POST /api/host/properties/:id/availability/block
```

Request:

```json
{
  "startDate": "2026-09-12",
  "endDate": "2026-09-16",
  "note": "Wyjazd właściciela"
}
```

Tworzy `HOST_BLOCK`.

Waliduj ownership oraz `endDate > startDate`.

---

# 13. Merge manual blocks

Przy dodawaniu `HOST_BLOCK` połącz istniejące manual blocks, które są:
- overlapping;
- adjacent.

Przykład:

```text
existing [10,12)
new      [12,15)
result   [10,15)
```

Operacja transakcyjna.

Nigdy nie merge'uj `HOST_BLOCK` z `EXTERNAL_CALENDAR`.

---

# 14. Manual unblock

Endpoint:

```http
POST /api/host/properties/:id/availability/unblock
```

Request:

```json
{
  "startDate": "2026-09-13",
  "endDate": "2026-09-14"
}
```

Unblock dotyczy wyłącznie `HOST_BLOCK`.

Nigdy nie usuwa external blocks.

---

# 15. Range subtraction

Musisz obsłużyć:

```text
existing [12,16)
unblock  [13,14)

result:
[12,13)
[14,16)
```

Możliwe efekty:
- usunięcie całego block;
- trim lewej strony;
- trim prawej strony;
- split na dwa blocks;
- no-op.

Operacja transakcyjna.

---

# 16. Host calendar API

Dodaj:

```http
GET /api/host/properties/:id/calendar?from=2026-09-01&to=2026-11-01
```

Response jako ranges, nie per-day rows:

```json
{
  "propertyId": "...",
  "from": "2026-09-01",
  "to": "2026-11-01",
  "blocks": [
    {
      "id": "...",
      "startDate": "2026-09-12",
      "endDate": "2026-09-16",
      "sourceType": "HOST_BLOCK",
      "sourceLabel": "Ręczna blokada"
    }
  ]
}
```

---

# 17. Host calendar UI

Dodaj route:

```text
/host/properties/[id]/calendar
```

lub spójną sekcję istniejącego Property editor.

Minimum:
- month navigation;
- today;
- available days;
- manual block;
- external block;
- select range;
- block;
- unblock manual range;
- source indicator.

Nie buduj Google Calendar clone.

---

# 18. ExternalCalendar model

Dodaj:

```text
external_calendars
```

Minimum:

```text
id
property_id
provider
name
import_url_encrypted
status

last_sync_started_at nullable
last_sync_succeeded_at nullable
last_sync_failed_at nullable
last_error_code nullable
last_error_message nullable
consecutive_failures

created_at
updated_at
```

Provider values:

```text
BOOKING
AIRBNB
VRBO
PMS
OTHER
```

Lifecycle:

```text
ACTIVE
DISABLED
```

---

# 19. iCal URL jest sekretem

Import URL może zawierać token.

Nie:
- loguj pełnego URL;
- zwracaj pełnego URL w GET;
- zapisuj plaintext, jeśli można łatwo tego uniknąć.

Zaszyfruj URL na poziomie aplikacji.

---

# 20. URL encryption

Użyj:

```text
AES-256-GCM
```

lub równoważnego authenticated encryption.

Env:

```text
ICAL_URL_ENCRYPTION_KEY
```

Klucz:
- nie trafia do DB;
- nie trafia do repo;
- powinien mieć poprawną długość;
- aplikacja ma fail-fast przy złej konfiguracji.

---

# 21. External calendar API

Dodaj:

```http
POST   /api/host/properties/:id/external-calendars
GET    /api/host/properties/:id/external-calendars
PATCH  /api/host/properties/:id/external-calendars/:calendarId
DELETE /api/host/properties/:id/external-calendars/:calendarId
POST   /api/host/properties/:id/external-calendars/:calendarId/sync
```

Create:
- validate ownership;
- validate URL;
- encrypt URL;
- save;
- enqueue initial sync.

GET zwraca tylko masked URL.

---

# 22. Remove/disable calendar

Po remove/disable:
- zatrzymaj przyszłe sync;
- usuń `EXTERNAL_CALENDAR` blocks tego kalendarza;
- nie dotykaj manual blocks.

DB changes wykonaj transakcyjnie.

---

# 23. SSRF protection — krytyczne

Backend fetchuje URL podany przez Host.

Dozwolone schematy:

```text
http
https
```

Blokuj m.in.:

```text
localhost
127.0.0.0/8
::1
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
100.64.0.0/10
fc00::/7
fe80::/10
cloud metadata endpoints
```

Blokuj też:
- `file:`;
- `ftp:`;
- `gopher:`;
- `data:`.

---

# 24. DNS/redirect SSRF

Walidacja musi działać:
- przed request;
- po DNS resolution;
- dla każdego redirect.

Nie wystarczy regex na hostname.

Redirect z public URL do private IP ma być zablokowany.

---

# 25. Fetch limits

Ustaw:
- timeout;
- max redirects;
- max response bytes.

Sugerowane MVP:

```text
timeout = 10s
max redirects = 3
max response = 5 MB
```

---

# 26. iCal parser

Użyj dojrzałej biblioteki.

Nie pisz RFC 5545 parsera regexami.

Minimum:
- `VEVENT`;
- `UID`;
- `DTSTART`;
- `DTEND`;
- `STATUS`;
- `SUMMARY`.

---

# 27. All-day events

Przykład:

```text
DTSTART;VALUE=DATE:20260912
DTEND;VALUE=DATE:20260916
```

Mapuj na:

```text
[2026-09-12, 2026-09-16)
```

Nie odejmuj dnia od `DTEND`.

---

# 28. Date-time events

Jeżeli feed używa timestampów:
- konwertuj do `Property.timeZone`;
- dopiero potem wyznacz local date range;
- dodaj testy off-by-one/timezone.

---

# 29. Cancelled / invalid events

`STATUS:CANCELLED` nie blokuje Availability.

Event bez poprawnego DTEND:
- pomiń z warningiem;
- nie twórz błędnej blokady.

Pełne RRULE expansion nie jest wymagane w MVP, ale parser nie może crashować.

---

# 30. Sync horizon

Preferuj:

```text
today - 30 days
today + 540 days
```

lub podobny rozsądny zakres.

Użyj Property timezone.

---

# 31. External event identity

Dla external blocks zapisuj:

```text
external_calendar_id
external_event_uid
```

Jeśli UID brak, wygeneruj stabilny fingerprint z normalized event data.

Nie generuj nowego losowego identity przy każdym sync.

---

# 32. Snapshot reconciliation — krytyczne

Feed iCal traktujemy jako snapshot aktualnego stanu dla danego horizon.

Dopiero po:

```text
successful fetch
+
successful parse
+
normalization
```

wykonaj w transakcji:

```text
insert new
update changed
delete removed
```

---

# 33. Failed sync preserves old availability

Jeśli wystąpi:
- network error;
- timeout;
- HTTP error;
- security rejection;
- parser failure;

to:

```text
NIE usuwaj istniejących EXTERNAL_CALENDAR blocks
```

Stary snapshot pozostaje.

---

# 34. No export loop

Nigdy nie eksportuj `EXTERNAL_CALENDAR` blocks przez Rezervio iCal export.

Na tym milestone export obejmuje tylko:

```text
HOST_BLOCK
```

W przyszłości może obejmować:

```text
BOOKING
```

---

# 35. Redis + BullMQ

Dodaj Redis wyłącznie do:
- queue;
- retries;
- scheduling.

Redis nie jest Availability source of truth.

Queue:

```text
calendar-sync
```

---

# 36. Automatic sync

Default:

```text
co 15 minut
```

Env:

```text
ICAL_SYNC_INTERVAL_MINUTES=15
```

Preferowany pattern:

```text
periodic sweep
→ find ACTIVE calendars due for sync
→ enqueue one job per calendar
```

Nie rób jednego wielkiego joba dla wszystkich calendars.

---

# 37. Retry

Temporary failure:
- retry;
- exponential backoff;
- np. 5 attempts.

Security/permanent validation failure:
- nie retryuj bezmyślnie.

Rozróżnij error codes.

---

# 38. Manual Sync now

Endpoint:

```http
POST /api/host/properties/:id/external-calendars/:calendarId/sync
```

Response:

```text
202 Accepted
```

Nie fetchuj zewnętrznego feedu synchronicznie w request thread.

Dedup wielokrotne kliknięcie przez `jobId` / equivalent.

---

# 39. Sync status

Host musi widzieć:
- last successful sync;
- failed sync;
- consecutive failures;
- pending/running status jeśli dostępne.

Przykład:

```text
Zsynchronizowano 3 min temu
```

lub:

```text
Synchronizacja nie powiodła się
```

---

# 40. iCal export token

Host może wygenerować unguessable, revocable export URL.

Dodaj tabelę:

```text
calendar_export_tokens
```

Minimum:

```text
id
property_id
token_hash
created_at
revoked_at nullable
```

Token:
- random >= 32 bytes;
- raw token zwracany tylko przy create/regenerate;
- DB przechowuje hash;
- nie loguj raw tokena.

---

# 41. Export API

Dodaj:

```http
POST   /api/host/properties/:id/calendar-export
POST   /api/host/properties/:id/calendar-export/regenerate
DELETE /api/host/properties/:id/calendar-export
```

Public endpoint np.:

```http
GET /api/calendar/ical/:token.ics
```

Nie wymaga session cookie.

---

# 42. Export content

Response:

```text
Content-Type: text/calendar; charset=utf-8
```

Eksportuj `HOST_BLOCK`.

Nie eksportuj `EXTERNAL_CALENDAR`.

VEVENT:

```text
DTSTART;VALUE=DATE:20260912
DTEND;VALUE=DATE:20260916
SUMMARY:Unavailable
UID:availability-block-{id}@rezervio
```

Nie umieszczaj:
- Host private note;
- external provider;
- emails;
- personal data.

---

# 43. Revoke/rotate

Po regenerate stary token przestaje działać.

Po revoke stary URL zwraca:

```text
404 lub 410
```

---

# 44. Public availability API

Dodaj:

```http
GET /api/properties/:slug/availability?from=...&to=...
```

Public response:

```json
{
  "propertyId": "...",
  "from": "2026-09-01",
  "to": "2026-10-01",
  "unavailableRanges": [
    {
      "startDate": "2026-09-12",
      "endDate": "2026-09-16"
    }
  ]
}
```

Nie ujawniaj publicznie:
- provider;
- external UID;
- Host note;
- sync error.

---

# 45. Search integration

Jeżeli podano `checkIn` i `checkOut`:

```text
NOT EXISTS overlapping AvailabilityBlock
```

ma być częścią SQL query.

Nie rób per-property queries.

Jeżeli dat brak:
- Search działa jak dotąd;
- nie filtruje Availability.

Wymagaj obu dat razem.

---

# 46. Property detail

Jeżeli detail request zawiera Stay, zwróć:

```text
available: true/false
```

używając dokładnie tej samej semantyki Availability.

---

# 47. iCal UX disclaimer

Host UI powinien jasno mówić:

```text
Kalendarze iCal nie synchronizują się w czasie rzeczywistym.
Synchronizacja odbywa się okresowo.
```

Nie obiecuj realtime.

---

# 48. Future Booking note

Dodaj do architecture docs:

> Future Booking flow musi zawsze ponownie sprawdzić PostgreSQL Availability przed utworzeniem BookingHold. iCal jest eventually consistent.

Nie implementuj Booking teraz.

---

# 49. Ownership

Obowiązkowo backendowo egzekwuj:

```text
Host A cannot:
- view Host B calendar
- block Host B dates
- unblock Host B dates
- add external calendar to Host B
- sync Host B calendar
- rotate Host B export token
```

Preferuj 404 dla foreign Property.

---

# 50. Sync transaction boundary

Network:

```text
fetch
parse
normalize
```

poza DB transaction.

DB transaction dopiero dla:

```text
reconcile
```

Nie trzymaj otwartej transakcji podczas network call.

---

# 51. Observability

Structured logs:

```text
calendar.sync.started
calendar.sync.succeeded
calendar.sync.failed
calendar.sync.security_rejected
calendar.sync.events_imported
```

Fields:
- calendarId;
- propertyId;
- provider;
- durationMs;
- eventCount;
- errorCode.

Nigdy nie loguj:
- full import URL;
- raw iCal;
- raw export token;
- private summary.

---

# 52. Local infra

Rozszerz `compose.yml`:

```text
db
object-storage
redis
```

Podman pozostaje preferowanym runtime.

Nie wymagaj Docker Desktop.

---

# 53. Environment

Rozszerz `.env.example`:

```env
REDIS_URL=redis://localhost:6379

ICAL_SYNC_INTERVAL_MINUTES=15
ICAL_FETCH_TIMEOUT_MS=10000
ICAL_MAX_RESPONSE_BYTES=5242880
ICAL_URL_ENCRYPTION_KEY=
```

README ma opisać bezpieczne wygenerowanie development encryption key.

---

# 54. Development flow

```bash
podman machine start   # jeśli potrzebne

pnpm infra:start
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`infra:start` uruchamia:
- PostgreSQL;
- object storage;
- Redis.

---

# 55. Tests — range semantics

Obowiązkowe:

```text
[12,16) overlaps [15,18)
[12,16) does not overlap [16,18)
[12,16) overlaps [12,16)
```

---

# 56. Tests — manual block/unblock

Testuj:
- create;
- adjacent merge;
- overlap merge;
- different source not merged;
- delete whole range;
- trim left;
- trim right;
- split middle;
- no-op;
- external blocks unaffected;
- ownership.

---

# 57. Tests — Search

Minimum:

```text
available Property returned
overlapping HOST_BLOCK filtered
adjacent non-overlap returned
EXTERNAL_CALENDAR filtered
Search without dates unaffected
DRAFT/SUSPENDED still not public
```

---

# 58. Tests — iCal parsing

Fixtures:
- all-day event;
- multiple events;
- cancelled;
- date-time + timezone;
- invalid event;
- missing DTEND.

Nie używaj live provider URL w testach.

---

# 59. Tests — reconciliation

Obowiązkowe:

```text
new inserted
existing unchanged
changed updated
removed deleted
cancelled removed
failed fetch keeps old blocks
failed parse keeps old blocks
```

---

# 60. Tests — SSRF

Minimum blokuj:
- localhost;
- 127.0.0.1;
- 10.x;
- 172.16/12;
- 192.168/16;
- 169.254.169.254;
- private IPv6;
- public redirect → private.

Nie wykonuj prawdziwych external calls w testach.

---

# 61. Tests — encryption

Minimum:

```text
URL encrypted at rest
decrypt roundtrip
wrong key/auth tag fails
DTO never returns plaintext URL
```

---

# 62. Tests — queue

Minimum:

```text
manual sync enqueues
duplicate sync deduped
temporary failure retries
security/permanent failure not blindly retried
successful job updates status
```

---

# 63. Tests — export

Minimum:

```text
token generated
wrong token rejected
revoked token rejected
HOST_BLOCK exported
EXTERNAL_CALENDAR excluded
DTEND exclusive
private note absent
rotation invalidates old token
```

---

# 64. OpenAPI/API client

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Jeśli używany jest generated TypeScript client:
- regeneruj go;
- nie twórz drugich ręcznych typów.

---

# 65. Database migrations

Schema changes wyłącznie przez Drizzle migrations.

Dodaj migracje dla:
- `availability_blocks`;
- `external_calendars`;
- `calendar_export_tokens`;
- enums/indexes.

Nie twórz daily availability table.

---

# 66. Existing data

Po migracji wszystkie istniejące PUBLISHED Property bez blocks są dostępne dla dowolnego Stay.

Nie niszcz obecnego seeda ani publication state.

---

# 67. No daily rows

Nie twórz:

```text
property_date_availability
```

z rekordem na każdy dzień.

Availability modelujemy zakresami.

---

# 68. No Redis source of truth

Canonical Availability pozostaje w PostgreSQL.

Redis = jobs only.

---

# 69. External event != Booking

Imported VEVENT zapisujemy jako:

```text
AvailabilityBlock(source=EXTERNAL_CALENDAR)
```

Nigdy jako fikcyjny Booking.

---

# 70. Manual end-to-end flow

Wykonaj:

```text
1. Login as Host
2. Open Property calendar
3. Block Sep 12–16
4. Verify manual block
5. Search Sep 13–15
6. Verify Property absent
7. Search Sep 16–18
8. Verify Property can appear
9. Unblock Sep 13–14
10. Verify split
11. Add test/mock external iCal
12. Sync now
13. Verify external block
14. Verify Host sees source
15. Verify public API hides source
16. Generate export URL
17. Fetch .ics
18. Verify HOST_BLOCK exported
19. Verify EXTERNAL_CALENDAR excluded
20. Disable/remove external calendar
21. Verify imported blocks disappear
```

---

# 71. Quality gates

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

# 72. Clean setup verification

Jeśli bezpieczne:

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

---

# 73. Definition of Done — Availability

Musi działać:

```text
daterange
half-open semantics
manual block
merge
manual unblock
split
Host calendar
public availability
Search filtering
```

---

# 74. Definition of Done — iCal import

Musi działać:

```text
ExternalCalendar create
URL encryption
SSRF-safe fetch
parser
normalization
snapshot reconciliation
failed sync preserves old blocks
manual sync
periodic sync
retry
status
```

---

# 75. Definition of Done — iCal export

Musi działać:

```text
generate token
public .ics
revoke/regenerate
HOST_BLOCK export
EXTERNAL_CALENDAR excluded
privacy-safe content
```

---

# 76. Definition of Done — Marketplace

Guest Search z:

```text
checkIn/checkOut
```

zwraca tylko Property bez kolidującej `AvailabilityBlock`.

To jest najważniejszy efekt milestone.

---

# 77. Dokumentacja

Zaktualizuj:

```text
README.md
docs/architecture.md
docs/domain-language.md
.env.example
OpenAPI
```

Architecture note musi jasno mówić:

```text
PostgreSQL = Availability source of truth
Redis/BullMQ = synchronization only
iCal = eventually consistent external source
```

---

# 78. Nie kończ w połowie

Nie akceptuj stanu, w którym:
- Calendar UI działa, ale Search ignoruje blocks;
- manual unblock nie potrafi splitować range;
- failed sync kasuje poprzednie external blocks;
- SSRF protection to tylko regex;
- EXTERNAL_CALENDAR trafia do exportu;
- ownership jest tylko frontendowe;
- testy/build nie przechodzą.

---

# 79. Raport końcowy agenta

Po zakończeniu podaj:

## Implemented
- Availability model;
- manual blocks;
- calendar UI;
- Search integration;
- ExternalCalendar;
- secure iCal fetch;
- sync/reconciliation;
- Redis/BullMQ;
- iCal export;
- tests;
- docs.

## Database migrations
Wypisz tables, indexes, enums.

## API
Wypisz nowe endpointy.

## Infrastructure
Wypisz Redis/BullMQ/compose/env changes.

## Verification

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual calendar flow: PASS/FAIL
```

## Security verification

```text
SSRF tests: PASS/FAIL
URL encryption tests: PASS/FAIL
ownership tests: PASS/FAIL
export token tests: PASS/FAIL
```

## Important decisions
Maksymalnie 5.

## Known limitations
Tylko realne ograniczenia, np. `iCal not realtime`, `RRULE limited`.

## Next milestone
Nie implementuj go. Wskaż tylko:

> **Milestone 04: Booking Core — BookingHold, transactional availability protection, request-to-book / instant booking state machine and Guest booking flow.**

---

# 80. Final principle

Po ukończeniu Milestone 03 Rezervio musi poprawnie odpowiadać na pytanie:

> **Czy konkretny Property jest dostępny dla konkretnego Stay?**

Źródła niedostępności:

```text
HOST_BLOCK
+
EXTERNAL_CALENDAR
```

muszą być spójne dla:
- Host calendar;
- Search;
- Property detail;
- przyszłego Booking validation.

Nie implementuj jeszcze Booking ani Payments.
