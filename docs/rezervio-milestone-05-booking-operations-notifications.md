# Rezervio — Milestone 05: Booking Operations & Notifications

> Cel: domknąć operacyjny flow rezerwacji bez płatności — Guest otrzymuje dostęp do statusu swojej rezerwacji, Host i Guest dostają powiadomienia, requesty mogą wygasać, a obie strony mogą obsłużyć podstawowe anulowanie Booking.

---

## 0. Instrukcja nadrzędna

Pracujesz na repozytorium Rezervio po ukończeniu Milestone 01–04.

Najpierw przeczytaj:

```text
docs/domain-language.md
docs/architecture.md
docs/milestone-01-backend-foundation.md
docs/milestone-02-host-property-management.md
docs/milestone-03-availability-calendar.md
docs/milestone-04-booking-core.md
```

Następnie:

1. przeanalizuj aktualny kod;
2. uruchom istniejące testy;
3. sprawdź aktualny Booking state machine;
4. dopiero potem rozpocznij implementację.

Nie implementuj Payments w tym milestone.

---

# 1. Główny rezultat biznesowy

Po ukończeniu ma działać realny flow:

```text
Guest
 ↓
wysyła Request-to-Book
 ↓
Host dostaje email
 ↓
Host Accept / Reject
 ↓
Guest dostaje email
 ↓
Guest otwiera bezpieczny link
 ↓
widzi status Booking
 ↓
Guest może anulować request/booking, jeśli status na to pozwala
```

oraz:

```text
Booking Request
 ↓
Host nie odpowiada
 ↓
request timeout
 ↓
Booking → EXPIRED
 ↓
Guest dostaje powiadomienie
```

---

# 2. Zakres

Zaimplementuj:

```text
Notification module
Email provider abstraction
local email testing
BullMQ notification jobs
Guest booking access token
Guest booking status page
Host notifications
Guest notifications
Request-to-Book expiration
Host request reminders
Guest cancellation
Host cancellation
Booking cancellation reasons
Booking timeline/history
notification idempotency
retry/backoff
OpenAPI
migrations
tests
docs
```

---

# 3. Poza zakresem

Nie implementuj:

```text
Stripe
Payment
Refund
Payout
PSP
KYC
real Host settlements
SMS
push notifications
chat/messaging
reviews
complex cancellation policy
cancellation fees
partial refunds
PMS reservation sync
native Booking/Airbnb API
Guest account/password login
```

---

# 4. Notification architecture

Powiadomienia są side effectem.

Nie wysyłaj emaila w tej samej transakcji co Booking state change.

Flow:

```text
Booking transaction
 ↓
commit
 ↓
enqueue notification job
 ↓
BullMQ
 ↓
email worker
 ↓
Email provider
```

Booking correctness nie zależy od sukcesu emaila.

---

# 5. Notification module

Dodaj moduł:

```text
notifications
```

Preferowana struktura:

```text
notifications/
├── application/
├── domain/
├── infrastructure/
└── templates/
```

Jeżeli repo ma inną konwencję, dostosuj się.

---

# 6. Email provider abstraction

Dodaj prostą abstrakcję:

```ts
interface EmailProvider {
  send(message: EmailMessage): Promise<void>
}
```

Implementacje:

```text
LocalEmailProvider
ProductionEmailProvider
```

Na tym milestone produkcyjny provider może być konfigurowalny, ale nie musi być finalnie wybrany.

Nie hardcoduj Resend/SendGrid/Postmark w domenie.

---

# 7. Local email testing

Lokalnie użyj:

```text
Mailpit
```

lub równoważnego lekkiego SMTP test server.

Uruchamiany przez Podman.

`compose.yml` po tym milestone:

```text
PostgreSQL
Object Storage
Redis
Mailpit
```

Mailpit ma pozwalać zobaczyć wszystkie lokalne emaile w przeglądarce.

---

# 8. Local SMTP env

Dodaj do `.env.example`:

```env
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
EMAIL_FROM=no-reply@rezervio.local
```

Jeżeli używasz Mailpit UI:

```text
http://localhost:8025
```

---

# 9. Production provider boundary

Architektura ma pozwolić później podpiąć np.:

```text
Resend
Postmark
SendGrid
AWS SES
```

bez zmiany BookingService.

Nie implementuj kilku providerów naraz.

---

# 10. Notification jobs

Użyj istniejącego Redis + BullMQ.

Queue:

```text
notifications
```

Job types:

```text
BOOKING_REQUEST_CREATED
BOOKING_REQUEST_ACCEPTED
BOOKING_REQUEST_REJECTED
BOOKING_REQUEST_EXPIRED
BOOKING_CONFIRMED
BOOKING_CANCELLED_BY_GUEST
BOOKING_CANCELLED_BY_HOST
BOOKING_REQUEST_REMINDER
```

`BOOKING_CONFIRMED` może być przygotowane na przyszłość, nawet jeśli Payments będą dopiero w Milestone 06.

---

# 11. Notification job payload

Payload powinien być minimalny:

```json
{
  "bookingId": "..."
}
```

Worker ładuje aktualne dane z DB.

Nie wkładaj całego Booking/Guest snapshot do Redis job payload.

---

# 12. Notification idempotency

Notification musi mieć logiczny dedup key.

Przykład:

```text
booking-request-created:{bookingId}
booking-request-accepted:{bookingId}
booking-cancelled-by-host:{bookingId}
```

Retry nie może wysłać 10 identycznych maili.

---

# 13. Notification delivery table

Dodaj:

```text
notification_deliveries
```

Minimum:

```text
id
booking_id
type
recipient_type
recipient_address
status
dedup_key
attempt_count
last_error_code nullable
sent_at nullable
created_at
updated_at
```

Status:

```text
PENDING
SENT
FAILED
```

Constraint:

```text
dedup_key UNIQUE
```

---

# 14. Email retry

Temporary provider error:

```text
retry
exponential backoff
```

Preferowane:

```text
5 attempts
```

Permanent invalid email:

```text
mark FAILED
no endless retry
```

---

# 15. Guest Booking access

Na MVP Guest nie posiada konta.

Dodaj bezpieczny mechanizm dostępu do Booking status.

Preferowany model:

```text
booking_guest_access_tokens
```

Pola:

```text
id
booking_id
token_hash
expires_at nullable
revoked_at nullable
created_at
last_used_at nullable
```

Raw token:
- losowy;
- minimum 32 bytes;
- nie zapisuj plaintext w DB;
- nie loguj.

---

# 16. Guest access URL

Email do Guest zawiera link np.:

```text
https://rezervio.../booking/{reference}?token=...
```

Lepsza opcja, jeśli architektura pozwala:

```text
token exchange
→ HttpOnly guest booking cookie
→ redirect do URL bez tokena
```

Jeżeli implementacja token exchange jest rozsądna, preferuj ją, żeby secret nie pozostawał w URL/history.

---

# 17. Guest token exchange

Preferowany endpoint:

```http
POST /api/bookings/:reference/access
```

Body:

```json
{
  "token": "..."
}
```

Backend:
- hashuje token;
- weryfikuje Booking;
- ustawia short/medium-lived HttpOnly cookie scoped do Guest booking access;
- frontend usuwa token z URL.

Jeżeli aktualny frontend nie wspiera tego łatwo, bezpieczny opaque token flow może pozostać prostszy.

---

# 18. Guest Booking status page

Dodaj route:

```text
/booking/[reference]
```

lub zgodny z istniejącym routingiem.

Pokaż:

```text
Booking reference
Property
Stay
Guest count
total price
status
booking mode
createdAt
Host response if applicable
```

Nie pokazuj danych Host, które nie są potrzebne.

---

# 19. Guest status states

UI musi czytelnie obsłużyć:

```text
PENDING_HOST_APPROVAL
PENDING_PAYMENT
CONFIRMED
CANCELLED
EXPIRED
COMPLETED
```

Płatność może być jeszcze nieaktywna, ale status `PENDING_PAYMENT` musi być zrozumiały.

---

# 20. Request expiration

Request-to-Book nie może wisieć wiecznie.

Dodaj TTL, np.:

```text
24 godziny
```

Env:

```env
BOOKING_REQUEST_TTL_SECONDS=86400
```

Nie hardcoduj w wielu miejscach.

---

# 21. Request expiry scheduling

Po utworzeniu:

```text
PENDING_HOST_APPROVAL
```

enqueue delayed BullMQ job:

```text
booking-request-expire
```

JobId:

```text
booking-request-expire:{bookingId}
```

---

# 22. Request expiration worker

Idempotentny flow:

```text
load Booking

if status != PENDING_HOST_APPROVAL:
  no-op

if deadline > now:
  safe no-op/reschedule

transaction:
  Booking → EXPIRED
  statusReason = HOST_RESPONSE_TIMEOUT
  expiredAt = now
commit

enqueue Guest notification
```

---

# 23. Deadline source of truth

Dodaj jawne pole:

```text
host_response_deadline_at
```

do Booking dla Request-to-Book.

Nie polegaj wyłącznie na delayed job timestamp w Redis.

Jeżeli worker się spóźni, API powinno móc rozpoznać, że request już logicznie wygasł.

---

# 24. Expired request semantics

`PENDING_HOST_APPROVAL` po deadline nie powinien dać się zaakceptować.

Host Accept:

```text
reload Booking
check deadline
```

Jeśli deadline minął:

```text
Booking → EXPIRED
409 BOOKING_REQUEST_EXPIRED
```

---

# 25. Host reminder

Opcjonalnie, ale zalecane:

```text
BOOKING_REQUEST_REMINDER
```

np. kilka godzin przed wygaśnięciem request.

Env:

```env
BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY=14400
```

Nie wysyłaj reminder, jeśli status już się zmienił.

---

# 26. Notification on Request creation

Po udanym Booking transaction:

```text
enqueue BOOKING_REQUEST_CREATED
```

Recipient:

```text
Host
```

Email minimum:

```text
New booking request
Property
Stay
Guest count
total price
deadline
CTA do Host Booking detail
```

---

# 27. Notification on Accept

Po:

```text
PENDING_HOST_APPROVAL → PENDING_PAYMENT
```

enqueue:

```text
BOOKING_REQUEST_ACCEPTED
```

Recipient:

```text
Guest
```

W tym milestone Guest może zobaczyć status `PENDING_PAYMENT`.

Nie implementuj jeszcze real payment CTA, jeśli Milestone 06 nie istnieje.

---

# 28. Notification on Reject

Po:

```text
PENDING_HOST_APPROVAL → CANCELLED
```

enqueue:

```text
BOOKING_REQUEST_REJECTED
```

Recipient:

```text
Guest
```

---

# 29. Notification on Expiry

Po request timeout:

```text
BOOKING_REQUEST_EXPIRED
```

Recipient:

```text
Guest
```

Opcjonalnie również Host, jeśli UX na tym zyskuje.

---

# 30. Guest cancellation

Dodaj Guest command:

```http
POST /api/bookings/:reference/cancel
```

Wymaga Guest access.

Allowed minimum:

```text
PENDING_HOST_APPROVAL
PENDING_PAYMENT
```

Dla `CONFIRMED`:
- nie implementuj jeszcze full cancellation policy;
- możesz zablokować cancel z jasnym komunikatem;
- lub pozwolić na cancel tylko jeśli produktowa decyzja jest jawna.

Preferowane w tym milestone:

```text
CONFIRMED cancellation = outside scope
```

bo refundy/płatności jeszcze nie istnieją.

---

# 31. Guest cancellation transition

Dla:

```text
PENDING_HOST_APPROVAL
```

transition:

```text
CANCELLED
statusReason = GUEST_CANCELLED
cancelledAt = now
```

Dla:

```text
PENDING_PAYMENT
```

musisz dodatkowo:
- zwolnić aktywny BookingHold;
- usunąć/dezaktywować `BOOKING_HOLD` AvailabilityBlock;
- użyć Property advisory lock;
- wykonać to transakcyjnie.

---

# 32. Guest cancellation notification

Po Guest cancel:

```text
BOOKING_CANCELLED_BY_GUEST
```

Recipient:

```text
Host
```

Guest może dostać confirmation email, jeśli dedup model to wspiera.

---

# 33. Host cancellation

Dodaj:

```http
POST /api/host/bookings/:id/cancel
```

Allowed minimum:

```text
PENDING_HOST_APPROVAL
PENDING_PAYMENT
```

Nie implementuj jeszcze cancel `CONFIRMED` z refund semantics.

---

# 34. Host cancellation transition

Dla `PENDING_PAYMENT`:
- Property advisory lock;
- release BookingHold;
- remove/deactivate hold block;
- Booking → CANCELLED;
- reason `HOST_CANCELLED`.

Dla `PENDING_HOST_APPROVAL`:
- Booking → CANCELLED.

---

# 35. Host cancellation notification

Po Host cancel:

```text
BOOKING_CANCELLED_BY_HOST
```

Recipient:

```text
Guest
```

---

# 36. Cancellation reasons

Dodaj canonical reason enum:

```text
GUEST_CANCELLED
HOST_CANCELLED
HOST_REJECTED
HOST_RESPONSE_TIMEOUT
HOLD_EXPIRED
AVAILABILITY_LOST
```

Nie używaj dowolnych stringów.

Możesz zachować `status_reason` z Milestone 04.

---

# 37. Booking timeline

Dodaj tabelę:

```text
booking_events
```

Minimum:

```text
id
booking_id
type
actor_type
actor_id nullable
metadata_json nullable
created_at
```

Event types np.:

```text
BOOKING_CREATED
HOST_ACCEPTED
HOST_REJECTED
REQUEST_EXPIRED
GUEST_CANCELLED
HOST_CANCELLED
HOLD_CREATED
HOLD_EXPIRED
```

---

# 38. Timeline purpose

Booking events służą do:

```text
auditability
Host/Guest timeline UI
debugging
future support
```

Nie używaj event table jako source of truth statusu.

`bookings.status` pozostaje canonical current state.

---

# 39. Actor types

Canonical:

```text
GUEST
HOST
SYSTEM
```

Nie zapisuj w timeline sekretów ani pełnego request payload.

---

# 40. Booking timeline UI

Guest status page może pokazać prosty timeline:

```text
Request sent
Accepted by Host
Waiting for payment
Cancelled
Expired
```

Host Booking detail również.

Nie buduj pełnego event-sourcing UI.

---

# 41. Booking state machine centralization

Wszystkie transitions mają przechodzić przez jawne application commands:

```text
acceptBookingRequest
rejectBookingRequest
expireBookingRequest
cancelBookingByGuest
cancelBookingByHost
expireBookingHold
```

Nie rób:

```text
PATCH /booking { status: ... }
```

---

# 42. Notification after commit

Krytyczna zasada:

```text
DB transaction commits first
then notification is enqueued
```

Nie wysyłaj emaila przed potwierdzonym zapisem biznesowym.

---

# 43. Reliable enqueue

Jeżeli projekt ma już outbox pattern — użyj go.

Jeżeli nie ma, w tym milestone można dodać prosty:

```text
outbox_events
```

dla krytycznych notification triggers.

Preferowane, jeśli implementacja jest rozsądna.

Nie jest wymagane budowanie pełnego event bus.

---

# 44. Transactional outbox — rekomendowane

Dla Booking transitions:

```text
transaction:
  change Booking
  insert BookingEvent
  insert OutboxEvent
commit
```

Następnie worker:

```text
outbox → BullMQ
```

Dzięki temu crash pomiędzy commit a `queue.add()` nie zgubi powiadomienia.

---

# 45. Outbox table

Jeżeli implementujesz:

```text
outbox_events
```

Minimum:

```text
id
type
aggregate_type
aggregate_id
payload_json
status
attempt_count
created_at
processed_at nullable
```

Status:

```text
PENDING
PROCESSING
PROCESSED
FAILED
```

---

# 46. Outbox processor

BullMQ / periodic worker:

```text
find PENDING
enqueue/process
mark PROCESSED
```

Operacje retry-safe.

Nie przechowuj PII bez potrzeby w payload.

Preferuj:

```text
bookingId
notificationType
```

---

# 47. Jeśli outbox zwiększa złożoność za bardzo

Minimum acceptable MVP:

```text
commit Booking
→ queue.add()
```

plus:
- retry;
- reconciliation job dla brakujących NotificationDelivery.

Ale agent powinien preferować outbox, jeśli da się wdrożyć bez rozwalenia scope.

---

# 48. Host notification email address

Użyj:

```text
Host → User.email
```

Nie duplikuj emaila na Property.

---

# 49. Guest email source

Użyj Booking Guest snapshot:

```text
guest_email
```

Email nie jest pobierany z requestu notification job.

---

# 50. Email templates

Zaimplementuj czytelne template'y dla:

```text
Host: new booking request
Guest: accepted
Guest: rejected
Guest: expired
Host: Guest cancelled
Guest: Host cancelled
Host: request reminder
```

HTML + text fallback.

Nie buduj marketingowego template engine.

---

# 51. Email content

Każdy email:
- brand Rezervio;
- jasny subject;
- Booking reference;
- Property;
- Stay;
- CTA jeśli potrzebne.

Nie umieszczaj zbędnych danych osobowych.

---

# 52. Local links

W development użyj env:

```env
APP_BASE_URL=http://localhost:3000
```

Nie hardcoduj domain.

---

# 53. Production readiness

Linki w email muszą być budowane z:

```text
APP_BASE_URL
```

Nie z request `Host` header.

---

# 54. Rate / abuse

Guest nie może powodować nieskończonego resend email.

Nie dodawaj publicznego resend endpoint, jeśli nie jest potrzebny.

Jeśli dodasz:
- rate limit;
- idempotency;
- Guest access.

---

# 55. Host bookings UX

`/host/bookings`

Dodaj filtry minimum:

```text
Pending
Waiting for payment
Cancelled
Expired
All
```

Wyraźnie pokaż requests wymagające działania.

---

# 56. Host dashboard indicator

Na `/host` pokaż:

```text
Pending booking requests
```

np. badge/count.

Nie buduj statystyk revenue.

---

# 57. Guest cancellation UX

Na Guest Booking page:

Jeśli cancellation allowed:

```text
[ Anuluj prośbę ]
```

lub:

```text
[ Anuluj rezerwację ]
```

Przed wykonaniem:
- confirmation dialog;
- jasna informacja o skutku.

---

# 58. Host cancellation UX

Na Host Booking detail:

```text
[ Anuluj ]
```

tylko dla dozwolonych statusów.

Nie pokazuj przycisku, jeśli transition nie jest dostępny.

Backend i tak weryfikuje transition.

---

# 59. Request expiry UX

Host Booking detail pokazuje:

```text
Odpowiedz do: ...
```

Guest status page:

```text
Gospodarz ma czas na odpowiedź do: ...
```

Po expiry:
- UI refetch;
- status `EXPIRED`.

---

# 60. Timezones

Deadlines to system instants:

```text
UTC
```

UI renderuje w właściwej local timezone.

Nie zapisuj request deadline jako local date.

---

# 61. BullMQ queues

Reuse Redis.

Queues:

```text
notifications
booking-lifecycle
```

lub zachowaj istniejące naming conventions.

Nie twórz osobnego Redis.

---

# 62. Booking request expire job

Job jest cleanup/transition mechanizmem, ale DB deadline jest source of truth.

API nie może zaakceptować request po deadline nawet jeśli worker jeszcze nie odpalił.

---

# 63. Reminder idempotency

Reminder max raz dla danego Booking/deadline.

Dedup key np.:

```text
booking-request-reminder:{bookingId}
```

---

# 64. Notification status visibility

Nie musisz pokazywać Guest/Host technicznego statusu email delivery.

Możesz udostępnić go w logs/admin future.

Nie blokuj Booking UX na failed email.

---

# 65. Logging

Structured events:

```text
notification.enqueued
notification.sent
notification.failed
booking.request.expired
booking.cancelled.guest
booking.cancelled.host
guest_access.created
guest_access.used
```

Nie loguj:
- raw token;
- pełnego email body;
- guest private data.

---

# 66. Security — Guest token

Guest access token:
- high entropy;
- hash at rest;
- revocable;
- constant-time comparison where relevant;
- not logged.

Nie używaj Booking reference jako auth secret.

---

# 67. Security — Guest status API

Guest może odczytać tylko swój Booking.

Nie zwracaj Host internal data.

Invalid token:
- 404 lub 401 zgodnie z API convention;
- nie ujawniaj więcej niż trzeba.

---

# 68. Security — Host actions

Host może cancel/accept/reject tylko Booking swoich Property.

Backend ownership checks obowiązkowe.

---

# 69. API endpoints

Minimum:

```http
GET  /api/bookings/:reference
POST /api/bookings/:reference/access
POST /api/bookings/:reference/cancel

GET  /api/host/bookings
GET  /api/host/bookings/:id
POST /api/host/bookings/:id/cancel
```

Istniejące:

```http
POST /api/host/bookings/:id/accept
POST /api/host/bookings/:id/reject
```

rozszerz o notifications/timeline/deadline semantics.

---

# 70. Booking response DTO

Guest DTO może zawierać:

```text
reference
status
statusReason
Property summary
Stay
Guest count
price
hostResponseDeadlineAt
createdAt
timeline
allowedActions
```

`allowedActions` może być backend-calculated, np.:

```json
{
  "canCancel": true
}
```

---

# 71. Host Booking DTO

Może zawierać:

```text
Guest name
Guest email
Guest phone
Property
Stay
Price
Status
Deadline
Timeline
Allowed actions
```

Nie zwracaj provider/internal secrets.

---

# 72. Migrations

Dodaj Drizzle migrations dla:

```text
booking_guest_access_tokens
notification_deliveries
booking_events
host_response_deadline_at
outbox_events (jeśli użyty)
```

---

# 73. Indexes

Minimum:

```text
booking_guest_access_tokens.token_hash UNIQUE
booking_guest_access_tokens.booking_id

notification_deliveries.dedup_key UNIQUE
notification_deliveries.booking_id
notification_deliveries.status

booking_events.booking_id
booking_events.created_at

bookings.host_response_deadline_at
```

---

# 74. Data retention

Nie hard-delete:
- Booking;
- BookingEvent;
- NotificationDelivery.

Guest access token może być revoked.

Nie usuwaj historii operacyjnej.

---

# 75. Tests — Guest access

Minimum:

```text
valid token works
invalid token rejected
revoked token rejected
token stored hashed
foreign Booking inaccessible
raw token never returned after initial issue unless explicitly intended
```

---

# 76. Tests — Request expiry

Minimum:

```text
deadline stored
request before deadline can be accepted
request after deadline cannot be accepted
worker → EXPIRED
worker retry idempotent
Guest notification scheduled once
```

---

# 77. Tests — reminder

Minimum:

```text
reminder only for PENDING_HOST_APPROVAL
no reminder after accept
no reminder after reject
no duplicate reminder
```

---

# 78. Tests — Guest cancellation

Minimum:

```text
PENDING_HOST_APPROVAL → CANCELLED
PENDING_PAYMENT → CANCELLED + Hold released
Availability becomes free
foreign/invalid Guest access rejected
retry idempotent
Host notification once
```

---

# 79. Tests — Host cancellation

Minimum:

```text
Host can cancel own Booking
foreign Host rejected
PENDING_PAYMENT releases Hold
Guest notification once
retry idempotent
```

---

# 80. Tests — Notification retry

Minimum:

```text
temporary SMTP failure retries
permanent failure marks FAILED
duplicate logical event sends one email
Booking state unaffected by email failure
```

---

# 81. Tests — local provider

Nie wymagaj realnego external email provider w automated tests.

Użyj:
- fake provider;
- SMTP integration test z Mailpit, jeśli rozsądne.

---

# 82. Tests — timeline

Każdy transition zapisuje dokładnie jeden logiczny BookingEvent.

Retry nie może tworzyć duplikatu eventu, jeśli ta sama command została już zastosowana.

---

# 83. Manual local flow

Wykonaj:

```text
1. pnpm infra:start
2. Open Mailpit
3. Guest creates Request-to-Book
4. Verify Host receives email
5. Open Host booking detail
6. Accept request
7. Verify Guest receives accepted email
8. Open Guest secure booking link
9. Verify status page
10. Create another Request
11. Reject
12. Verify Guest rejection email
13. Create another Request with short test TTL
14. Let it expire
15. Verify EXPIRED + email
16. Create PENDING_PAYMENT Booking/Hold
17. Guest cancels
18. Verify Hold released
19. Verify Availability restored
20. Verify Host receives cancellation email
```

---

# 84. Local infra

Po milestone:

```text
Podman
├── PostgreSQL
├── Object Storage
├── Redis
└── Mailpit
```

Preferowane:

```bash
pnpm infra:start
pnpm infra:stop
```

Mailpit powinien startować automatycznie.

---

# 85. `.env.example`

Dodaj:

```env
APP_BASE_URL=http://localhost:3000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
EMAIL_FROM=no-reply@rezervio.local

BOOKING_REQUEST_TTL_SECONDS=86400
BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY=14400
```

---

# 86. README

Dodaj:

```text
Local email testing
Mailpit URL
Booking notification flow
Guest access link
Request expiration
Cancellation flow
```

README ma być praktyczne.

---

# 87. Domain language

Zaktualizuj `docs/domain-language.md`.

Musi jasno definiować:

```text
Guest Booking Access
BookingEvent
Booking status reason
Request expiration
Guest cancellation
Host cancellation
```

Nie twórz synonimów dla Booking.

---

# 88. Architecture docs

Zaktualizuj `docs/architecture.md`.

Dodaj:
- notification side effects;
- BullMQ email jobs;
- optional/recommended transactional outbox;
- Guest opaque access token;
- request expiry;
- Booking timeline;
- cancellation command boundaries.

---

# 89. OpenAPI / typed client

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Regeneruj typed API client, jeśli projekt go używa.

---

# 90. Quality gates

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

również.

---

# 91. Definition of Done — Notifications

Musi działać:

```text
Host receives new request email
Guest receives accept email
Guest receives reject email
Guest receives expiry email
Host receives Guest cancel email
Guest receives Host cancel email
retry
dedup
local Mailpit
```

---

# 92. Definition of Done — Guest access

Musi działać:

```text
secure opaque token
hashed at rest
Guest status page
status refresh
timeline
allowed actions
```

---

# 93. Definition of Done — Booking operations

Musi działać:

```text
Request expiry
deadline source of truth
Host reminder
Guest cancellation
Host cancellation
Hold release
Availability restored
Booking timeline
```

---

# 94. Definition of Done — local operations

Developer może lokalnie:

```text
create request
see Host email
accept/reject
see Guest email
open secure Guest booking page
wait for request expiry
cancel Booking
see Availability restore
```

bez zewnętrznego email provider.

---

# 95. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
Booking transaction zależy od SMTP
email jest wysyłany przed commit
Guest Booking page jest dostępna tylko po publicReference
request może zostać accepted po deadline
PENDING_PAYMENT cancellation nie zwalnia Hold
email retry powoduje duplicate messages
Booking status jest zmieniany przez frontend
```

---

# 96. Raport końcowy agenta

Po zakończeniu podaj:

## Implemented

```text
Notification module
Mailpit local email
Guest access token
Guest Booking page
Request expiry
Reminder
Guest cancellation
Host cancellation
Booking timeline
BullMQ jobs
tests
docs
```

## Database migrations
Wypisz tabele, pola, indeksy, constraints.

## API
Wypisz nowe/zmienione endpointy.

## Notification verification

```text
request-created email: PASS/FAIL
accepted email: PASS/FAIL
rejected email: PASS/FAIL
expired email: PASS/FAIL
Guest-cancel email: PASS/FAIL
Host-cancel email: PASS/FAIL
dedup: PASS/FAIL
retry: PASS/FAIL
```

## Booking operations

```text
Guest access: PASS/FAIL
request expiry: PASS/FAIL
Guest cancel: PASS/FAIL
Host cancel: PASS/FAIL
Hold release: PASS/FAIL
Availability restoration: PASS/FAIL
timeline: PASS/FAIL
```

## Quality

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual flow: PASS/FAIL
```

## Important decisions
Maksymalnie 5.

## Known limitations
Tylko realne.

## Next milestone

Nie implementuj.

Wskaż:

> **Milestone 06: Payments & Booking Confirmation — Stripe sandbox, PaymentIntent, verified webhooks, atomic Booking confirmation, Refund recovery and Stripe Connect foundation.**

---

# 97. Final principle

Po Milestone 05 Rezervio ma być operacyjnie używalne nawet bez płatności:

```text
Guest
 ↓
Request
 ↓
Host notification
 ↓
Accept / Reject
 ↓
Guest notification
 ↓
secure Booking status
 ↓
expiration / cancellation
```

Booking state pozostaje source of truth w PostgreSQL.

Redis/BullMQ obsługuje asynchroniczne side effects, a Mailpit umożliwia pełne lokalne testowanie emaili.

Nie implementuj jeszcze Payments.
