# Rezervio — Milestone 04: Booking Core

> Cel: zbudować transakcyjny fundament rezerwacji Rezervio — Guest booking flow, Request-to-Book, BookingHold, ochronę przed double bookingiem oraz Host approval workflow. Bez integracji z płatnościami.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–03.

Najpierw:
1. przeanalizuj aktualny kod;
2. uruchom istniejące testy;
3. przeczytaj:
   - `docs/domain-language.md`
   - `docs/architecture.md`
   - `docs/milestone-01-backend-foundation.md`
   - `docs/milestone-02-host-property-management.md`
   - `docs/milestone-03-availability-calendar.md`
4. dopiero potem rozpocznij implementację.

Canonical terms:

```text
Guest
Host
Property
Stay
Availability
AvailabilityBlock
Booking
BookingHold
BookingMode
PriceQuote
```

Nie zmieniaj podstawowego stacku.

---

# 1. Aktualny stack

```text
Frontend:       Next.js + React + TypeScript
Backend:        NestJS + Fastify
Database:       PostgreSQL
ORM:            Drizzle ORM
Availability:   PostgreSQL daterange / AvailabilityBlock
Jobs:           Redis + BullMQ
Auth:           server-side sessions for Host
Object storage: S3-compatible
Local infra:    Podman
Architecture:   Modular Monolith
API:            REST + OpenAPI
```

---

# 2. Główny rezultat biznesowy

## Request-to-Book

```text
Guest
 ↓
Property + Stay
 ↓
Booking Request
 ↓
Host Accept / Reject
 ↓
Accept
 ↓
ponowna walidacja Availability
 ↓
BookingHold
 ↓
PENDING_PAYMENT
```

## Instant Book foundation

```text
Guest
 ↓
Property + Stay
 ↓
Reserve
 ↓
transakcyjne sprawdzenie Availability
 ↓
Booking + BookingHold
 ↓
PENDING_PAYMENT
```

Płatności będą w Milestone 05.

---

# 3. Zakres

Zaimplementuj:
- `BookingMode`;
- `Booking`;
- `BookingHold`;
- Guest data snapshot;
- PriceQuote snapshot;
- Request-to-Book;
- Instant Book backend flow;
- transactional Availability validation;
- ochronę przed double bookingiem;
- property-level PostgreSQL advisory lock;
- BookingHold expiration;
- BullMQ delayed expiration job;
- Host booking/request list;
- Host accept/reject;
- Guest booking form;
- status UI;
- idempotency;
- OpenAPI;
- migrations;
- testy;
- docs.

---

# 4. Poza zakresem

Nie implementuj:

```text
Payment
PSP
Stripe
Adyen
Refund
Payout
KYC
Host payout onboarding
email/SMS provider
PMS reservation creation
Guest account
reviews
cancellation policy engine
dynamic pricing
coupons
```

Nie twórz fake payment provider.

---

# 5. BookingMode

Dodaj do Property:

```text
booking_mode
```

Values:

```text
REQUEST_TO_BOOK
INSTANT_BOOK
```

Default:

```text
REQUEST_TO_BOOK
```

Host może zmienić BookingMode w Property editor.

---

# 6. Booking statuses

Ujednolić domain language do:

```text
PENDING_HOST_APPROVAL
PENDING_PAYMENT
CONFIRMED
CANCELLED
EXPIRED
COMPLETED
```

W tym milestone aktywnie używamy:

```text
PENDING_HOST_APPROVAL
PENDING_PAYMENT
CANCELLED
EXPIRED
```

`CONFIRMED` będzie osiągany przez Payment workflow w Milestone 05.

---

# 7. Booking table

Dodaj:

```text
bookings
```

Minimum:

```text
id
public_reference
property_id
host_id
booking_mode
status
status_reason nullable

check_in
check_out
adults
children

guest_name
guest_email
guest_phone nullable

property_title_snapshot

accommodation_amount_minor
cleaning_fee_amount_minor
service_fee_amount_minor
tax_amount_minor
discount_amount_minor
total_amount_minor
currency

created_at
updated_at
host_responded_at nullable
cancelled_at nullable
expired_at nullable
confirmed_at nullable
```

---

# 8. Guest snapshot

Na MVP Guest nie potrzebuje konta.

Booking zapisuje:

```text
guest_name
guest_email
guest_phone
```

Validation:

```text
name required
email valid
phone optional
```

Nie twórz `GuestAccount`.

---

# 9. Stay

Zawsze:

```text
[checkIn, checkOut)
```

DB constraint:

```text
check_out > check_in
```

Guest count:

```text
adults >= 1
children >= 0
adults + children <= Property.maxGuests
```

---

# 10. Financial snapshot

Backend wywołuje istniejący PricingService / `calculatePriceQuote`.

Snapshot:

```text
accommodation_amount_minor
cleaning_fee_amount_minor
service_fee_amount_minor
tax_amount_minor
discount_amount_minor
total_amount_minor
currency
```

Na tym milestone wartości niezaimplementowane mogą wynosić `0`.

Frontend nie może ustalać finalnej ceny.

---

# 11. BookingHold

Dodaj:

```text
booking_holds
```

Minimum:

```text
id
booking_id
property_id
date_range
status
expires_at
created_at
released_at nullable
expired_at nullable
```

Status:

```text
ACTIVE
RELEASED
EXPIRED
CONVERTED
```

`booking_id` unique.

---

# 12. Hold TTL

Default:

```text
10 minut
```

Env:

```text
BOOKING_HOLD_TTL_SECONDS=600
```

---

# 13. AvailabilityBlock integration

Rozszerz `AvailabilityBlock.source_type` o:

```text
BOOKING_HOLD
BOOKING
```

W tym milestone używamy `BOOKING_HOLD`.

Powiąż block z Hold/Booking w jednoznaczny sposób.

---

# 14. Expired Hold nie blokuje Availability

To krytyczny invariant.

`BOOKING_HOLD` blokuje tylko jeśli:

```text
hold.status = ACTIVE
AND expires_at > now()
```

Jeżeli BullMQ worker się spóźni, wygasły Hold nadal nie może blokować Search ani nowego Booking.

---

# 15. Property-level advisory lock

Wprowadź jeden canonical helper/pattern, np.:

```text
withPropertyAvailabilityLock(propertyId)
```

W transakcji użyj PostgreSQL:

```text
pg_advisory_xact_lock(...)
```

Lock jest deterministycznie związany z Property.

---

# 16. Dlaczego lock

Chroni race:

```text
Guest A → available
Guest B → available
```

Poprawnie:

```text
A lock
A recheck
A creates Hold
A commit

B lock
B recheck
B gets 409
```

---

# 17. Wszystkie Availability writes korzystają z tego samego lock pattern

Minimum:
- create BookingHold;
- manual HOST_BLOCK;
- manual unblock;
- external calendar reconciliation;
- Host accept Request-to-Book.

Zaktualizuj Milestone 03 implementation, jeśli potrzeba.

---

# 18. Create Instant Booking transaction

Jedna krótka transaction:

```text
BEGIN
acquire Property lock
reload Property
verify PUBLISHED
verify INSTANT_BOOK
validate capacity
recheck Availability
calculate PriceQuote
create Booking(PENDING_PAYMENT)
create BookingHold(ACTIVE)
create AvailabilityBlock(BOOKING_HOLD)
COMMIT
```

Żadnych network calls wewnątrz transakcji.

---

# 19. Revalidation

Nigdy nie ufaj Availability z wcześniejszego Search.

Przed Hold:

```text
recheck Availability inside transaction
```

Conflict:

```text
409 PROPERTY_NOT_AVAILABLE
```

---

# 20. Public create Booking

Endpoint:

```http
POST /api/bookings
```

Request:

```json
{
  "propertyId": "...",
  "checkIn": "2026-09-12",
  "checkOut": "2026-09-16",
  "adults": 2,
  "children": 1,
  "guest": {
    "name": "Jan Kowalski",
    "email": "jan@example.com",
    "phone": "+48..."
  }
}
```

Backend sam wybiera flow na podstawie `Property.bookingMode`.

---

# 21. INSTANT_BOOK result

Tworzy:

```text
Booking = PENDING_PAYMENT
BookingHold = ACTIVE
AvailabilityBlock = BOOKING_HOLD
```

Response zawiera:

```text
bookingReference
status
holdExpiresAt
server-calculated price
```

Nie implementuj płatności.

---

# 22. REQUEST_TO_BOOK result

Tworzy:

```text
Booking = PENDING_HOST_APPROVAL
```

Nie tworzy Hold.

Request-to-Book nie blokuje inventory przez cały czas oczekiwania na Host.

---

# 23. Request validation

Przy create sprawdź:
- PUBLISHED;
- REQUEST_TO_BOOK;
- valid Stay;
- capacity;
- current Availability;
- server price.

Host Accept sprawdzi Availability ponownie.

---

# 24. Host bookings

Frontend:

```text
/host/bookings
/host/bookings/[id]
```

API:

```http
GET /api/host/bookings
GET /api/host/bookings/:id
```

Opcjonalne filtry:

```text
status
propertyId
```

Host widzi tylko Booking własnych Property.

---

# 25. Host Accept

Endpoint:

```http
POST /api/host/bookings/:id/accept
```

Allowed:

```text
PENDING_HOST_APPROVAL
```

Transaction:

```text
acquire Property lock
reload Booking
verify ownership/status
recheck Availability
create BookingHold
create BOOKING_HOLD AvailabilityBlock
Booking → PENDING_PAYMENT
hostRespondedAt = now
commit
```

---

# 26. Availability lost before Accept

Jeżeli termin przestał być dostępny:

```text
409
```

Booking ustaw jako:

```text
EXPIRED
```

z:

```text
status_reason = AVAILABILITY_LOST
```

Nie twórz Hold.

---

# 27. Host Reject

Endpoint:

```http
POST /api/host/bookings/:id/reject
```

Transition:

```text
PENDING_HOST_APPROVAL → CANCELLED
```

Reason:

```text
HOST_REJECTED
```

Operacja retry-safe.

---

# 28. BookingHold expiration

Po utworzeniu Hold enqueue BullMQ delayed job:

```text
booking-hold-expire
```

JobId:

```text
booking-hold-expire:{holdId}
```

Delay do `expiresAt`.

---

# 29. Expiration worker

Idempotentny flow:

```text
load Hold
if not ACTIVE → no-op
if not expired → safe no-op/reschedule

transaction:
  acquire Property lock
  reload
  Hold → EXPIRED
  release/deactivate BOOKING_HOLD block
  Booking PENDING_PAYMENT → EXPIRED
commit
```

---

# 30. BullMQ nie jest source of truth

Availability musi ignorować expired Hold nawet przed cleanup job.

BullMQ służy do:
- cleanup;
- status transition;
- porządkowania danych.

---

# 31. Idempotency POST /api/bookings

Wymagaj:

```text
Idempotency-Key
```

Same key + same payload:

```text
same Booking result
```

Same key + different payload:

```text
409
```

Preferuj PostgreSQL jako canonical persistence idempotency.

Nie opieraj correctness na Redis.

---

# 32. Idempotency table

Jeśli potrzebna:

```text
idempotency_keys
```

Minimum:

```text
id
scope
key_hash
request_hash
resource_type
resource_id
created_at
expires_at
```

Nie zapisuj pełnego Guest request bez potrzeby.

---

# 33. Host command idempotency

Retry `accept` nie może tworzyć drugiego Hold.

Retry `reject` nie może powodować niepoprawnego transition.

---

# 34. Guest UI

Publiczne Property detail ma działający CTA:

Dla:

```text
REQUEST_TO_BOOK
```

tekst np.:

```text
Wyślij prośbę
```

Dla:

```text
INSTANT_BOOK
```

tekst np.:

```text
Zarezerwuj
```

---

# 35. Booking form

Dodaj route zgodny z aktualnym routingiem, np.:

```text
/booking/[propertySlug]
```

Pokaż:
- Property;
- Stay;
- guests;
- total price;
- BookingMode;
- Guest name;
- email;
- phone optional;
- CTA.

---

# 36. Request success UI

`PENDING_HOST_APPROVAL`:

```text
Prośba została wysłana.
Gospodarz musi ją zaakceptować.
```

Pokaż:
- bookingReference;
- Stay;
- Property;
- price.

Nie pokazuj jako confirmed.

---

# 37. Instant success UI

`PENDING_PAYMENT`:

Pokaż:
- Booking summary;
- countdown Hold;
- `holdExpiresAt`;
- jasny status.

Nie implementuj fake payment.

Countdown jest tylko UX; backend time jest source of truth.

---

# 38. Guest status access

Nie implementuj Guest account.

Jeśli potrzebna jest odświeżalna strona statusu, użyj opaque guest-access token z hashem w DB.

Nie używaj `publicReference` jako jedynego sekretu.

Nie komplikuj, jeśli aktualny flow tego nie wymaga.

---

# 39. Booking state transitions

W tym milestone:

```text
REQUEST_TO_BOOK:

PENDING_HOST_APPROVAL
  → PENDING_PAYMENT
  → EXPIRED

PENDING_HOST_APPROVAL
  → CANCELLED
```

Instant:

```text
PENDING_PAYMENT
  → EXPIRED
```

Future:

```text
PENDING_PAYMENT
  → CONFIRMED
```

Nie pozwalaj controllerowi dowolnie ustawiać statusu.

---

# 40. Application commands

Preferuj jawne:

```text
createBooking
acceptBookingRequest
rejectBookingRequest
expireBookingHold
releaseBookingHold
```

Nie generic:

```text
updateBookingStatus(...)
```

---

# 41. Future Payment boundary

Przygotuj czytelną granicę na przyszłość:

```text
PENDING_PAYMENT
→ successful Payment
→ CONFIRMED
```

W Milestone 05 `BOOKING_HOLD` zostanie transakcyjnie zastąpiony przez `BOOKING` AvailabilityBlock.

Nie implementuj Payment teraz.

---

# 42. Search integration

Aktywny BookingHold blokuje Search.

Expired/released Hold nie blokuje.

Nie zmieniaj innych Search semantics bez potrzeby.

---

# 43. Security / privacy

Nie loguj:
- guest full email;
- guest phone;
- guest access token.

Host DTO może dostać Guest contact potrzebny do obsługi request.

Publiczne DTO nie ujawnia prywatnych danych.

---

# 44. Logging

Structured events:

```text
booking.created
booking.requested
booking.request.accepted
booking.request.rejected
booking.hold.created
booking.hold.expired
booking.hold.released
booking.availability_conflict
```

---

# 45. Migrations

Drizzle migrations dla:
- `properties.booking_mode`;
- `bookings`;
- `booking_holds`;
- AvailabilityBlock additions;
- idempotency table, jeśli potrzebna;
- guest access tokens, jeśli potrzebne;
- indexes/constraints.

---

# 46. Indexes

Minimum:

```text
bookings.public_reference UNIQUE
bookings.property_id
bookings.host_id
bookings.status
bookings.created_at

booking_holds.booking_id UNIQUE
booking_holds.property_id
booking_holds.status
booking_holds.expires_at
```

---

# 47. DB constraints

Minimum:
- `check_out > check_in`;
- `adults >= 1`;
- `children >= 0`;
- money >= 0;
- valid status/mode;
- real foreign keys.

---

# 48. Tests — double booking

Najważniejszy test milestone.

Uruchom równolegle dwa requesty:

```text
same Property
overlapping Stay
```

Expected:

```text
exactly one succeeds
other = 409 PROPERTY_NOT_AVAILABLE
```

To musi być integration/e2e test z prawdziwym PostgreSQL.

---

# 49. Tests — boundary dates

Dwa Stay:

```text
[12,16)
[16,18)
```

mogą oba utworzyć Hold.

---

# 50. Tests — existing blocks

Booking/Hold odrzucony przy overlap z:
- HOST_BLOCK;
- EXTERNAL_CALENDAR;
- active BOOKING_HOLD.

Expired Hold nie blokuje.

---

# 51. Tests — Request-to-Book

Minimum:

```text
creates PENDING_HOST_APPROVAL
no Hold
no BOOKING_HOLD block
Accept rechecks Availability
Accept creates Hold
Accept → PENDING_PAYMENT
Reject → CANCELLED
double Accept does not create second Hold
foreign Host cannot accept/reject
```

---

# 52. Tests — lost availability

```text
Guest creates Request
another block appears
Host accepts
```

Expected:

```text
409
Booking EXPIRED / AVAILABILITY_LOST
no Hold
```

---

# 53. Tests — Instant Book

Minimum:

```text
creates PENDING_PAYMENT
creates ACTIVE Hold
creates AvailabilityBlock
Search excludes overlap
```

---

# 54. Tests — expiration

Minimum:

```text
expired Hold ignored before cleanup
BullMQ job expires Hold
Booking → EXPIRED
block released
retry idempotent
```

---

# 55. Tests — idempotency

```text
same key + same payload → same Booking
same key + different payload → 409
retry doesn't create second Hold
```

---

# 56. Tests — price

```text
backend calculates price
client cannot override total
snapshot unchanged after Property price change
```

---

# 57. Tests — ownership

Host A nie może:
- list/read Host B Booking;
- accept Host B request;
- reject Host B request.

---

# 58. Manual end-to-end flow

```text
1. Host sets Property = REQUEST_TO_BOOK
2. Guest selects dates
3. Guest submits request
4. Verify PENDING_HOST_APPROVAL
5. Verify no Hold
6. Host sees request
7. Host accepts
8. Verify Availability recheck
9. Verify BookingHold
10. Verify PENDING_PAYMENT
11. Verify overlapping Search excludes Property
12. Let/force Hold expire
13. Verify Booking EXPIRED
14. Verify Property available again

15. Host sets another Property = INSTANT_BOOK
16. Guest submits
17. Verify PENDING_PAYMENT + Hold
18. Run two concurrent overlapping requests
19. Verify exactly one succeeds
20. Verify no double booking/hold
```

---

# 59. Redis + BullMQ

Reuse existing Redis/BullMQ.

Dodaj:

```text
booking-hold-expire
```

Nie używaj BullMQ do synchronous create Booking.

Nie twórz nowego Redis instance.

---

# 60. Environment

Dodaj:

```env
BOOKING_HOLD_TTL_SECONDS=600
```

Jeśli potrzeba:

```env
BOOKING_IDEMPOTENCY_TTL_SECONDS=86400
```

---

# 61. Domain docs

Zaktualizuj `docs/domain-language.md`.

Musi jednoznacznie opisywać:
- BookingMode;
- Booking;
- BookingHold;
- statuses;
- PENDING_HOST_APPROVAL;
- PENDING_PAYMENT;
- EXPIRED;
- half-open Stay.

Usuń stare sprzeczne definicje.

---

# 62. Architecture docs

Zaktualizuj `docs/architecture.md` o:
- PostgreSQL advisory lock per Property;
- Availability concurrency strategy;
- BookingHold lifecycle;
- BullMQ expiration;
- idempotency;
- future Payment boundary.

---

# 63. OpenAPI / client

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Jeżeli client jest generowany — regeneruj go.

---

# 64. Quality gates

Muszą przejść:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Jeżeli jest:

```bash
pnpm test:e2e
```

również.

Concurrency test jest obowiązkowy.

---

# 65. Definition of Done

## Booking

```text
BookingMode działa
Booking działa
Guest snapshot działa
price snapshot działa
REQUEST_TO_BOOK działa
INSTANT_BOOK backend działa
Host accept/reject działa
state transitions są kontrolowane
```

## BookingHold

```text
transactional creation
AvailabilityBlock integration
TTL
expired Hold nie blokuje
BullMQ cleanup
idempotent expiration
```

## Concurrency

Udowodnione testem:

```text
2 concurrent overlapping attempts
→ exactly 1 succeeds
```

## Marketplace

Guest może:
- wybrać Stay;
- zobaczyć cenę;
- podać dane;
- wysłać request / rozpocząć Instant Book;
- dostać prawidłowy status.

Host może:
- zobaczyć request;
- accept;
- reject.

---

# 66. Nie kończ w połowie

Nie akceptuj implementacji, w której:
- Availability nie jest rewalidowane wewnątrz transakcji;
- frontend chroni przed double bookingiem;
- Redis lock jest jedyną ochroną;
- expired Hold blokuje do czasu odpalenia worker;
- backend ufa cenie z browsera;
- Request-to-Book blokuje inventory przez cały czas oczekiwania Host;
- concurrency test nie przechodzi.

---

# 67. Raport końcowy agenta

Po zakończeniu podaj:

## Implemented
- BookingMode;
- Booking;
- BookingHold;
- advisory lock;
- Request-to-Book;
- Instant Book;
- Host management;
- expiration;
- idempotency;
- UI;
- tests;
- docs.

## Database migrations
Wypisz tabele, pola, indeksy, constraints.

## API
Wypisz endpointy.

## Concurrency verification

```text
overlapping concurrent attempts: PASS/FAIL
```

## Quality

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual Booking flow: PASS/FAIL
```

## Important decisions
Maksymalnie 5.

## Known limitations
Tylko realne.

## Next milestone

Nie implementuj go.

Wskaż:

> **Milestone 05: Payments & Booking Confirmation — marketplace PSP, payment intent, webhook-driven confirmation, Refund foundation and conversion of BookingHold into confirmed Booking availability.**

---

# 68. Final principle

Najważniejsza właściwość Milestone 04:

> **Rezervio nie może zaakceptować dwóch nakładających się rezerwacji tego samego Property wskutek race condition.**

Correctness zapewniają:

```text
PostgreSQL transaction
+
property-level advisory lock
+
Availability recheck
+
BookingHold
+
idempotency
```

Redis/BullMQ służy do expiration/cleanup, ale nie jest source of truth.

Nie implementuj jeszcze Payments.
