# Rezervio — Milestone 08: Payments & Booking Confirmation

> Cel: dodać bezpieczną obsługę płatności w Stripe sandbox, potwierdzać Booking wyłącznie na podstawie wiarygodnego server-side sygnału od PSP oraz atomowo zamieniać tymczasowy `BOOKING_HOLD` na trwały `BOOKING` AvailabilityBlock.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–07.

Najpierw:
1. przeanalizuj aktualny Booking lifecycle, BookingHold, AvailabilityBlock, idempotency, Redis/BullMQ, Guest access i Host auth;
2. uruchom istniejące testy;
3. przeczytaj `docs/domain-language.md`, `docs/architecture.md` oraz milestone 01–08;
4. dopiero potem rozpocznij implementację.

Nie implementuj jeszcze pełnego Host Settlement/Payout lifecycle.

---

## 1. PSP decision

Dla MVP użyj:

```text
Stripe
Stripe PaymentIntents
Stripe Elements
Stripe sandbox
```

Dla marketplace foundation użyj Stripe Connect tylko w zakresie Host payment account/readiness.

Nie używaj live keys.

---

## 2. Provider abstraction

Core domeny nie może zależeć od Stripe.

Dodaj prostą granicę:

```ts
interface PaymentProvider {
  createPayment(...): Promise<...>
  cancelPayment(...): Promise<...>
  createRefund(...): Promise<...>
}
```

Implementacja:

```text
StripePaymentProvider
```

Nie buduj rozbudowanego multi-PSP frameworka.

---

## 3. Główny flow

Po wcześniejszych milestone:

```text
Booking = PENDING_PAYMENT
BookingHold = ACTIVE
```

Teraz:

```text
Guest
 ↓
PaymentIntent
 ↓
Stripe Elements
 ↓
Stripe
 ↓
verified webhook: payment succeeded
 ↓
PostgreSQL transaction
+
Property advisory lock
 ↓
Payment = SUCCEEDED
Booking = CONFIRMED
BookingHold = CONVERTED
BOOKING_HOLD → BOOKING
```

---

## 4. Najważniejsza zasada

Frontend nie jest source of truth dla sukcesu płatności.

Nie wolno:

```text
client says success
→ Booking CONFIRMED
```

Booking może przejść:

```text
PENDING_PAYMENT → CONFIRMED
```

wyłącznie po poprawnie zweryfikowanym server-side evencie od PSP lub po bezpiecznym server-side reconciliation.

---

## 5. Zakres

Zaimplementuj:

```text
Payment model
Payment state machine
Stripe sandbox
PaymentIntent creation
Stripe Elements
3DS/SCA
webhook endpoint
webhook signature verification
webhook idempotency
Booking confirmation
atomic BOOKING_HOLD → BOOKING conversion
failed payment handling
payment retry while Hold active
late payment race handling
Refund foundation
automatic full refund for late success
Stripe Connect Host account foundation
Host payment readiness
local Stripe CLI workflow
OpenAPI
migrations
tests
docs
```

---

## 6. Poza zakresem

Nie implementuj:

```text
real production payouts
Host settlement ledger
scheduled transfers
payout after stay
manual payout admin
chargeback/dispute workflow
complex cancellation refunds
tax engine
VAT accounting
saved cards
Guest wallet
subscriptions
PayU
Adyen
direct BLIK integration
production launch with live Stripe keys
```

Host Settlement & Payouts będą w Milestone 10.

---

## 7. Payment model

Dodaj tabelę `payments`.

Minimum:

```text
id
booking_id
provider
provider_payment_id nullable
status
amount_minor
currency
failure_code nullable
failure_message nullable
created_at
updated_at
succeeded_at nullable
failed_at nullable
cancelled_at nullable
```

Provider:

```text
STRIPE
```

---

## 8. Payment statuses

Canonical:

```text
CREATED
PROCESSING
REQUIRES_ACTION
SUCCEEDED
FAILED
CANCELLED
REFUND_PENDING
REFUNDED
PARTIALLY_REFUNDED
```

Nie mapuj 1:1 wszystkich Stripe statusów do domeny.

---

## 9. Amount source

Payment amount pochodzi wyłącznie z:

```text
Booking.total_amount_minor
Booking.currency
```

Client nie może ustalać authoritative amount.

---

## 10. Create Payment endpoint

Dodaj np.:

```http
POST /api/bookings/:reference/payment
```

Wymaga prawidłowego Guest access.

Flow:

```text
verify Guest access
load Booking
require PENDING_PAYMENT
require ACTIVE non-expired BookingHold
create/reuse Payment
create/retrieve Stripe PaymentIntent
return clientSecret
```

---

## 11. Stripe idempotency

Mutujące Stripe calls używają stabilnych idempotency keys:

```text
payment-create:{paymentId}
refund:{refundId}
payment-cancel:{paymentId}
```

Retry tej samej operacji nie może tworzyć nowego efektu.

---

## 12. Network boundary

Nie wykonuj Stripe API call w długiej PostgreSQL transaction.

Preferuj:

```text
DB validate/read
 ↓
Stripe API call
 ↓
short DB transaction persist provider state
```

Flow musi być retry-safe.

---

## 13. PaymentIntent metadata

Minimum:

```text
bookingId
paymentId
bookingReference
```

Nie dodawaj zbędnych danych Guest.

---

## 14. Payment UI

Na Booking `PENDING_PAYMENT` użyj Stripe Elements.

Pokaż:

```text
Property
Stay
Guest count
Total Price
Hold countdown
Stripe payment form
Pay CTA
```

Nie buduj własnych inputów na card number/CVC/expiry.

---

## 15. Hold validation

Payment można rozpocząć tylko jeśli:

```text
Booking = PENDING_PAYMENT
BookingHold = ACTIVE
BookingHold.expiresAt > now()
```

Jeśli Hold wygasł:

```text
409 BOOKING_HOLD_EXPIRED
```

---

## 16. 3DS / SCA

Flow musi obsługiwać:

```text
requires_action
3D Secure
SCA
```

Nie traktuj `requires_action` jako final failure.

---

## 17. Webhook endpoint

Dodaj:

```http
POST /api/webhooks/stripe
```

Endpoint:
- nie wymaga Host/Guest session;
- weryfikuje Stripe signature;
- korzysta z raw body;
- odrzuca invalid signature.

Env:

```env
STRIPE_WEBHOOK_SECRET=
```

---

## 18. Provider event persistence

Dodaj `payment_provider_events`.

Minimum:

```text
id
provider
provider_event_id
event_type
processed_at nullable
created_at
```

Unique:

```text
(provider, provider_event_id)
```

---

## 19. Webhook idempotency

Ten sam event może przyjść wielokrotnie.

Wymaganie:

```text
same provider_event_id
→ exactly one domain effect
```

Duplicate event:

```text
200 OK
no duplicate Booking transition
no duplicate Refund
```

---

## 20. payment succeeded

Po zweryfikowanym success evencie:

```text
resolve Payment
verify provider_payment_id
verify amount
verify currency
```

Następnie:

```text
BEGIN
acquire Property advisory lock
reload Booking
reload BookingHold
reload Payment

if Booking already CONFIRMED:
  no-op

else if:
  Booking == PENDING_PAYMENT
  AND Hold == ACTIVE
  AND Hold.expiresAt > now()

then:
  Payment → SUCCEEDED
  Booking → CONFIRMED
  Booking.confirmedAt = now
  BookingHold → CONVERTED
  remove/deactivate BOOKING_HOLD AvailabilityBlock
  create BOOKING AvailabilityBlock

COMMIT
```

---

## 21. Atomic Availability conversion

To krytyczny invariant.

Nie wolno:

```text
remove BOOKING_HOLD
COMMIT
create BOOKING
```

Konwersja:

```text
BOOKING_HOLD → BOOKING
```

musi być w jednej transaction pod tym samym Property advisory lock.

---

## 22. BOOKING AvailabilityBlock

Confirmed Booking tworzy:

```text
AvailabilityBlock.sourceType = BOOKING
```

Powiąż z `booking_id`.

Confirmed Booking blokuje Availability niezależnie od Redis/BullMQ.

---

## 23. Late payment race

Może wystąpić:

```text
BookingHold expiration
vs
payment success webhook
```

Oba flow używają tego samego Property advisory lock.

### Webhook wins

```text
Booking → CONFIRMED
Hold → CONVERTED
no refund
```

### Expiry wins

```text
Booking → EXPIRED
Payment = SUCCEEDED
DO NOT confirm Booking
enqueue full refund
```

Reason:

```text
PAYMENT_AFTER_HOLD_EXPIRY
```

---

## 24. Refund foundation

Dodaj `refunds`.

Minimum:

```text
id
payment_id
booking_id
provider_refund_id nullable
type
status
amount_minor
currency
reason
created_at
updated_at
succeeded_at nullable
failed_at nullable
```

Type:

```text
FULL
PARTIAL
```

Status:

```text
PENDING
PROCESSING
SUCCEEDED
FAILED
```

---

## 25. Refund worker

Reuse Redis + BullMQ.

Job:

```text
payment-refund
```

Flow:

```text
load Refund
if SUCCEEDED → no-op
call PaymentProvider.createRefund()
with stable idempotency key
persist provider state
```

Temporary failure:
- retry;
- exponential backoff.

---

## 26. Failed payment

Przy provider failure:

```text
Payment → FAILED
```

Booking może pozostać `PENDING_PAYMENT` dopóki Hold jest active.

Guest może spróbować ponownie.

Nie zwalniaj Hold po pojedynczym decline.

---

## 27. Hold expiry and provider cancel

Gdy Hold wygasa:
- DB uwalnia Availability zgodnie z wcześniejszym milestone;
- enqueue best-effort `payment-provider-cancel`, jeśli PaymentIntent jest cancellable.

Nie czekaj na Stripe przed uwolnieniem Availability.

---

## 28. Stripe Connect foundation

Dodaj preferowaną tabelę:

```text
host_payment_accounts
```

Minimum:

```text
id
host_id
provider
provider_account_id
onboarding_status
charges_enabled
payouts_enabled
details_submitted
created_at
updated_at
```

Unique:

```text
(host_id, provider)
provider_account_id
```

---

## 29. Host payment readiness

Canonical:

```text
NOT_STARTED
IN_PROGRESS
READY
RESTRICTED
```

Nie mapuj całego Stripe Account object do DB.

---

## 30. Host Connect API

Dodaj:

```http
POST /api/host/payments/connect-account
POST /api/host/payments/onboarding-link
GET  /api/host/payments/status
```

Create account idempotent.

Onboarding provider-hosted.

Nie buduj własnego KYC.

---

## 31. Host payment UI

Dodaj/rozszerz:

```text
/host/payments
```

Minimum:

```text
Status płatności
[ Skonfiguruj płatności ]
[ Dokończ konfigurację ]
```

---

## 32. Settlement/Payouts

Nie implementuj teraz:
- Host balance;
- Transfer;
- Payout;
- delayed payout;
- post-stay settlement.

To będzie Milestone 10.

---

## 33. PlatformFee

Jeżeli model PlatformFee już istnieje:
- snapshot w Booking/Payment;
- nie hardcoduj procentu w wielu miejscach.

Jeżeli fee nie jest finalną decyzją:
- użyj config/service;
- dev może mieć 0.

---

## 34. Local Stripe sandbox

Development działa na test/sandbox keys.

`.env.example`:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

Dodaj inne Connect env tylko jeśli potrzebne.

---

## 35. Local webhook testing

README ma opisać Stripe CLI.

Lokalny endpoint np.:

```text
http://localhost:3001/api/webhooks/stripe
```

Stripe CLI forwarduje eventy na localhost.

Nie wymagaj publicznego deploymentu.

---

## 36. Local scenarios

Minimum:

```text
successful payment
declined card
3DS
failed payment
duplicate webhook
webhook replay
late webhook
refund
Connect onboarding
```

Nie używaj prawdziwych kart.

---

## 37. Podman

Nie dodawaj Stripe do compose.

Local infra pozostaje:

```text
PostgreSQL
Object Storage
Redis
Mailpit
```

Stripe sandbox jest zewnętrzny.

---

## 38. Guest status UI

Po webhook:

```text
Booking = CONFIRMED
```

Guest widzi:

```text
Rezerwacja potwierdzona
```

Pokaż:
- Booking reference;
- Property;
- Stay;
- Guest count;
- total price;
- payment status.

---

## 39. Pending / failed / expired UI

### PENDING_PAYMENT

```text
Przetwarzamy płatność
```

Frontend może refetch/polling.

### FAILED

```text
Płatność nie powiodła się.
Spróbuj ponownie przed wygaśnięciem blokady.
```

### EXPIRED

```text
Termin nie jest już zablokowany.
Sprawdź ponownie dostępność.
```

Nie pozwalaj retry po expiry.

---

## 40. Security / PCI boundary

Rezervio backend nie otrzymuje:
- card number;
- CVC;
- expiry.

Nie loguj:
- Stripe secret;
- webhook secret;
- PaymentIntent client secret;
- card data;
- full Stripe objects.

---

## 41. No distributed transaction

Nie rób:

```text
BEGIN DB
→ Stripe call
→ COMMIT
```

jako pseudo-distributed transaction.

Używaj:
- local ACID;
- Stripe idempotency;
- webhooks;
- state machine;
- reconciliation;
- BullMQ recovery.

---

## 42. Database migrations

Drizzle migrations dla:

```text
payments
refunds
payment_provider_events
host_payment_accounts
AvailabilityBlock BOOKING relation
required indexes/constraints
```

---

## 43. Tests — Payment create

Minimum:

```text
only PENDING_PAYMENT
active Hold required
amount from Booking snapshot
frontend amount ignored
retry doesn't duplicate Payment
expired Hold rejected
Guest access enforced
```

---

## 44. Tests — Webhook

Minimum:

```text
valid signature accepted
invalid signature rejected
missing signature rejected
duplicate event no duplicate effect
```

---

## 45. Tests — Successful confirmation

```text
PENDING_PAYMENT
+ ACTIVE Hold
+ succeeded event

→ Payment SUCCEEDED
→ Booking CONFIRMED
→ Hold CONVERTED
→ BOOKING_HOLD removed/deactivated
→ BOOKING block exists
```

---

## 46. Tests — Availability continuity

Integration test ma udowodnić, że Hold → Booking conversion nie otwiera okna dostępności.

---

## 47. Tests — Expiry race

Obowiązkowe dwa concurrency scenarios.

### Webhook wins

```text
succeeded webhook vs expiry
→ CONFIRMED
→ no Refund
```

### Expiry wins

```text
expiry vs succeeded webhook
→ Booking EXPIRED
→ Payment SUCCEEDED
→ exactly one FULL Refund requested
```

---

## 48. Tests — Amount mismatch

Provider amount/currency mismatch:

```text
Booking NOT confirmed
integrity error
recovery/refund if needed
```

---

## 49. Tests — Failed payment / Refund / Connect

Minimum:

```text
FAILED payment leaves Booking payable while Hold active
Refund exactly once
provider retry idempotent
Connect account create idempotent
Connect onboarding link
Connect status refresh
cross-Host isolation
```

---

## 50. Manual sandbox flow

Wykonaj:

```text
1. Configure Stripe sandbox keys
2. Host completes sandbox Connect onboarding
3. Guest creates Booking → PENDING_PAYMENT
4. PaymentIntent created
5. Guest pays test card
6. Stripe CLI forwards webhook
7. Booking → CONFIRMED
8. Hold → CONVERTED
9. BOOKING block exists
10. overlapping Search excludes Property

11. Test declined payment
12. Verify retry while Hold active

13. Test 3DS
14. Complete challenge
15. Verify only webhook confirms Booking

16. Replay duplicate webhook
17. Verify no duplicate effects

18. Force expiry-before-success race
19. Verify Booking not confirmed
20. Verify exactly one Refund
```

---

## 51. README / docs

README: dodaj `Local Stripe sandbox` z:
- keys;
- env;
- Stripe CLI;
- webhook forwarding;
- success;
- decline;
- 3DS;
- replay;
- refund;
- Connect onboarding.

Zaktualizuj `docs/domain-language.md` o:
- Payment;
- Refund;
- PlatformFee;
- Payment vs Payout;
- statuses;
- webhook source-of-truth.

Zaktualizuj `docs/architecture.md` o:
- PaymentProvider boundary;
- Stripe sandbox/live separation;
- webhook-driven confirmation;
- provider-event idempotency;
- atomic Hold → Booking conversion;
- late-payment refund recovery;
- Connect foundation;
- future Settlement/Payout boundary.

---

## 52. OpenAPI / client

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Regeneruj typed client, jeśli istnieje.

---

## 53. Quality gates

Muszą przejść:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Jeżeli istnieje:

```bash
pnpm test:e2e
```

również.

Concurrency/recovery tests są obowiązkowe.

---

## 54. Definition of Done

### Payment

```text
Payment model
Stripe PaymentIntent
Stripe Elements
sandbox payment
webhook verification
webhook idempotency
failed payment
3DS
retry while Hold active
```

### Booking Confirmation

```text
webhook is source of truth
PENDING_PAYMENT → CONFIRMED
Hold → CONVERTED
BOOKING_HOLD → BOOKING
atomic transaction
Property advisory lock
```

### Recovery

```text
late successful Payment does not confirm expired Booking
full Refund requested
Refund exactly once
provider retries
```

### Connect

```text
Host connected account
onboarding link
payment readiness
```

Pełne payouty poza zakresem.

---

## 55. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
frontend callback potwierdza Booking
webhook signature nie jest sprawdzana
duplicate webhook duplikuje efekty
backend ufa cenie z browsera
Hold → Booking nie jest atomowe
expired Booking może być confirmed po late success
late Payment nie ma refund recovery
raw card data trafia do NestJS
local development wymaga live keys
```

---

## 56. Raport końcowy

Po zakończeniu podaj:

### Implemented
- Payment;
- Stripe provider;
- Elements;
- webhook;
- Booking confirmation;
- refund recovery;
- Connect foundation;
- tests;
- docs.

### Database migrations
Wypisz tabele, pola, indeksy, constraints.

### API
Wypisz nowe endpointy.

### Stripe sandbox verification

```text
successful payment: PASS/FAIL
decline: PASS/FAIL
3DS: PASS/FAIL
webhook forwarding: PASS/FAIL
duplicate webhook: PASS/FAIL
refund: PASS/FAIL
Connect onboarding: PASS/FAIL
```

### Concurrency / recovery

```text
webhook-vs-expiry: PASS/FAIL
late-payment refund: PASS/FAIL
Hold→Booking atomic conversion: PASS/FAIL
```

### Quality

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual payment flow: PASS/FAIL
```

### Important decisions
Maksymalnie 5.

### Known limitations
Tylko realne.

### Next milestone

Nie implementuj.

Wskaż tylko:

> **Milestone 09: Stay Operations & Guest Communication — check-in/check-out instructions, stay information, scheduled guest notifications, controlled access-code reveal and Booking-scoped Guest↔Host messaging.**

---

## 57. Final principle

Najważniejsza reguła:

> Pieniądze są uznane przez Rezervio dopiero po wiarygodnym server-side sygnale od PSP, a potwierdzenie Booking musi zachować ciągłość blokady Availability.

Correctness:

```text
Stripe sandbox / PSP
+
verified webhook
+
provider idempotency
+
PostgreSQL transaction
+
Property advisory lock
+
Booking state machine
+
Refund recovery
```

Nie implementuj jeszcze pełnego Host Settlement/Payout lifecycle.
