# Rezervio — Milestone 10: Host Settlement & Payouts

> Cel: domknąć finansowy lifecycle po stronie Hosta. Rezervio ma rozliczyć opłaconą rezerwację, określić ile należy się Hostowi, wstrzymać środki do właściwego momentu, wykonać Stripe Connect Transfer w sandboxie oraz obserwować Payout do banku Hosta.

---

## 0. Instrukcja dla agenta

Pracujesz na repo po ukończeniu Milestone 01–09.

Przeczytaj tylko:

```text
CLAUDE.md
docs/domain-language.md
docs/architecture.md
docs/project-state.md        # jeśli istnieje
docs/milestone-10-host-settlement-payouts.md
```

Następnie przeanalizuj aktualny kod, szczególnie:

```text
Booking
Payment
Refund
Booking financial snapshot / PlatformFee
StripePaymentProvider
Stripe Connect Host account
payment webhooks
BullMQ
Booking completion
```

Nie czytaj milestone 01–09, chyba że napotkasz konkretną niejasność.

Całość implementuj i testuj wyłącznie w Stripe sandbox/test mode. Nie używaj live keys ani realnych pieniędzy.

---

# 1. Canonical terminology

Te cztery pojęcia muszą być jednoznacznie rozdzielone.

## Payment

```text
Guest → Stripe / Rezervio
```

Odpowiada na pytanie:

> Czy Guest zapłacił za Booking?

## Settlement

Wewnętrzne rozliczenie Rezervio:

```text
gross amount
- platform fee
= host amount
```

Odpowiada na pytanie:

> Ile należy się Hostowi i kiedy środki mogą zostać zwolnione?

Settlement nie jest przelewem.

## Transfer

Stripe Connect:

```text
Platform Stripe balance
        ↓
Connected Account Hosta
```

To jest główna operacja finansowa kontrolowana przez Rezervio.

## Payout

Stripe:

```text
Connected Account Hosta
        ↓
rachunek bankowy Hosta
```

`Transfer != Payout`.

---

# 2. Główny flow

Przykład dla Booking 1000 PLN:

```text
Guest Payment = 1000 PLN
        ↓
Payment = SUCCEEDED
Booking = CONFIRMED
        ↓
Settlement
  gross       = 1000 PLN
  platformFee =   50 PLN
  hostAmount  =  950 PLN
  status      = PENDING
        ↓
releaseAt
        ↓
Settlement = AVAILABLE
        ↓
Stripe Connect Transfer 950 PLN
        ↓
Settlement = TRANSFERRED
        ↓
Connected Account Hosta
        ↓
Payout
        ↓
bank Hosta
```

---

# 3. Release policy

Nie wykonuj Transfer natychmiast po `Payment = SUCCEEDED`.

Na MVP użyj konfigurowalnej polityki:

```text
CHECK_IN_PLUS_DELAY
```

Default:

```env
HOST_SETTLEMENT_RELEASE_DELAY_HOURS=24
```

Czyli domyślnie:

```text
check-in + 24h
```

Nie hardcoduj 24h w domenie.

W testach/dev nie czekaj realnie 24h — użyj fake clock, test helpera albo konfiguracji z delay `0`.

---

# 4. Zakres

Zaimplementuj:

```text
Settlement model + state machine
financial snapshot per Booking
releaseAt
Host pending/available/transferred amounts
Stripe Connect Transfer
Transfer idempotency
Transfer retry/recovery
Payout status observation
refund impact on Settlement
Transfer Reversal foundation
financial reconciliation
Host finance UI
sandbox-only manual test flow
BullMQ jobs
webhooks
OpenAPI
migrations
tests
docs
```

---

# 5. Poza zakresem

Nie implementuj:

```text
Stripe live mode
real-money transfers
advanced accounting ledger
VAT/tax engine
invoice generation
chargebacks/disputes
partial-stay settlement
multi-host revenue split
co-host payouts
FX conversion engine
external accounting integration
manual production payouts
```

---

# 6. Settlement model

Dodaj:

```text
booking_settlements
```

Minimum:

```text
id
booking_id
host_id
property_id
currency

gross_amount_minor
platform_fee_minor
host_amount_minor

status
release_at

provider
provider_transfer_id nullable

created_at
updated_at
available_at nullable
transferred_at nullable
cancelled_at nullable
failed_at nullable
failure_code nullable
failure_message nullable
```

Constraint:

```text
booking_id UNIQUE
```

Jeden canonical Settlement per Booking.

---

# 7. Amount source

Kwoty pochodzą wyłącznie z immutable Booking financial snapshot.

```text
gross_amount_minor = Booking total snapshot
platform_fee_minor = Booking PlatformFee snapshot
host_amount_minor = gross - platform fee
```

Nie pobieraj authoritative amount z frontend/request body.

Nie przeliczaj starego Booking przy użyciu aktualnej prowizji Rezervio.

Pieniądze przechowuj jako minor units / istniejący bezpieczny Money abstraction.

---

# 8. Settlement statuses

Canonical:

```text
PENDING
AVAILABLE
TRANSFER_PENDING
TRANSFERRED
CANCELLED
FAILED
REVERSAL_PENDING
REVERSED
```

---

# 9. Settlement creation

Settlement powstaje idempotentnie po:

```text
Payment = SUCCEEDED
Booking = CONFIRMED
```

Wymaganie:

```text
one Booking → exactly one Settlement
```

Duplicate webhook/event nie może utworzyć kolejnego Settlement.

---

# 10. releaseAt

Wylicz z:

```text
Booking.checkIn
+ Property check-in time
+ HOST_SETTLEMENT_RELEASE_DELAY_HOURS
```

z uwzględnieniem:

```text
Property.timeZone
```

Zapisz wynik jako canonical instant.

BullMQ job nie jest source of truth. Source of truth to:

```text
Settlement.release_at
Settlement.status
Booking.status
Payment/Refund state
```

---

# 11. Settlement release job

Dodaj BullMQ job:

```text
settlement-release
```

Flow:

```text
load Settlement
verify status = PENDING
verify now >= releaseAt
verify Booking still eligible
verify Payment SUCCEEDED
verify no blocking Refund
transition PENDING → AVAILABLE
enqueue settlement-transfer
```

Operacja musi być idempotentna.

Nie uwalniaj Settlement dla:

```text
CANCELLED
EXPIRED
```

Booking `CONFIRMED` lub prawidłowo `COMPLETED` może być eligible.

---

# 12. Stripe Connect strategy

Najpierw sprawdź architekturę faktycznie zaimplementowaną w Milestone 08.

Jeśli nie została jeszcze ostatecznie ustalona, preferuj model zgodny z:

```text
Separate Charges and Transfers
```

czyli:

```text
Guest Payment → platform charge

later:

Platform → Stripe Connect Transfer → Host connected account
```

Nie przebudowuj poprawnej istniejącej architektury bez potrzeby.

---

# 13. Transfer model

Dodaj:

```text
host_transfers
```

Minimum:

```text
id
settlement_id
host_id
provider
provider_transfer_id nullable
amount_minor
currency
status
created_at
updated_at
succeeded_at nullable
failed_at nullable
reversed_at nullable
failure_code nullable
failure_message nullable
```

Statusy:

```text
PENDING
PROCESSING
SUCCEEDED
FAILED
REVERSAL_PENDING
REVERSED
```

---

# 14. Transfer rules

Transfer amount:

```text
Settlement.host_amount_minor
```

Nigdy z browsera.

Host musi mieć Stripe Connect account w stanie umożliwiającym Transfer.

Jeżeli Host payment account nie jest READY:

```text
Settlement pozostaje AVAILABLE
```

UI pokazuje:

```text
Dokończ konfigurację płatności, aby otrzymać środki.
```

To nie jest utrata Settlement ani financial failure.

---

# 15. Transfer idempotency

Stable Stripe idempotency key:

```text
settlement-transfer:{settlementId}
```

Zabezpiecz również w DB.

Dwa joby/workery nie mogą stworzyć dwóch Transferów dla jednego Settlement.

---

# 16. Transfer worker

BullMQ:

```text
settlement-transfer
```

Flow:

```text
load Settlement + Transfer
verify AVAILABLE / TRANSFER_PENDING
verify Host Connect READY
persist TRANSFER_PENDING
call Stripe outside long DB transaction
persist provider_transfer_id
Transfer → SUCCEEDED
Settlement → TRANSFERRED
```

Temporary failure → retry/backoff.

Nie gub Settlement po błędzie Stripe.

---

# 17. Payout

Payout oznacza:

```text
Connected Account balance → bank Hosta
```

Nie zakładaj, że Rezervio zawsze bezpośrednio tworzy Payout.

Zależy to od faktycznie używanego Stripe Connect account type i payout schedule.

Milestone ma co najmniej:

```text
obserwować payout lifecycle
persistować status
pokazywać użyteczny status Hostowi
obsłużyć sandbox success/failure, jeśli dany Connect model to wspiera
```

Jeżeli potrzebne, dodaj:

```text
host_payouts
```

Minimum:

```text
id
host_id
provider
provider_payout_id
amount_minor
currency
status
arrival_at nullable
created_at
updated_at
paid_at nullable
failed_at nullable
failure_code nullable
failure_message nullable
```

Canonical statuses:

```text
PENDING
IN_TRANSIT
PAID
FAILED
CANCELLED
```

Nie obchodź ograniczeń Stripe tylko po to, żeby wymusić platform-triggered payout.

---

# 18. Refund before Transfer

Jeżeli full Refund nastąpi przed Transfer:

```text
Refund succeeds
        ↓
Settlement → CANCELLED
        ↓
no Transfer
```

Dotyczy również Settlement `AVAILABLE`, jeśli Transfer jeszcze nie został wykonany.

---

# 19. Refund after Transfer

Dla modelu Separate Charges and Transfers refund charge nie musi automatycznie cofnąć wcześniejszego Transfer.

Dlatego full Refund po Transfer wymaga skoordynowania:

```text
Refund
+
Transfer Reversal
```

---

# 20. Transfer Reversal

Dodaj minimalny model:

```text
host_transfer_reversals
```

Minimum:

```text
id
transfer_id
settlement_id
provider_reversal_id nullable
amount_minor
currency
status
reason
created_at
updated_at
succeeded_at nullable
failed_at nullable
```

Status:

```text
PENDING
PROCESSING
SUCCEEDED
FAILED
```

Stable idempotency key:

```text
transfer-reversal:{reversalId}
```

Flow po full Refund wykonanym po Transfer:

```text
Settlement TRANSFERRED
        ↓
REVERSAL_PENDING
        ↓
exactly one Transfer Reversal
        ↓
REVERSED
```

Nie implementuj pełnego partial-refund accounting, jeśli produkt go jeszcze nie potrzebuje.

---

# 21. Race conditions

Obsłuż przynajmniej:

```text
release vs cancellation/refund
multiple release jobs
multiple transfer jobs
refund vs transfer success
reconciliation vs webhook
```

Wymagane:

```text
DB invariants
short transactions
Stripe idempotency
provider event idempotency
```

Nie używaj Property advisory lock, jeśli nie dotyczy to inventory. Użyj właściwego lock/transaction dla financial state.

---

# 22. Reconciliation

Webhook nie jest jedynym recovery mechanism.

Dodaj BullMQ job:

```text
financial-reconciliation
```

Sprawdza limitowanymi batchami m.in.:

```text
TRANSFER_PENDING
retryable FAILED transfer
provider_transfer_id + uncertain local state
pending/in-transit payouts
refund/reversal mismatch
```

Nie skanuj całej tabeli bez indeksów.

---

# 23. Webhooks

Rozszerz istniejący verified Stripe webhook handler o potrzebne eventy dla:

```text
Connect account readiness
Transfer lifecycle
Payout lifecycle
```

Reuse istniejące:

```text
payment_provider_events
```

jeśli pasuje architektonicznie.

Wymagane:

```text
signature verification
raw body
idempotency
out-of-order safety
duplicate safety
```

---

# 24. Host balance / summary

Host powinien widzieć przynajmniej:

```text
Pending
Available
Transferred
```

Opcjonalnie:

```text
Paid out
```

jeżeli dane Payout są wiarygodnie dostępne.

Preferuj read model/projection z Settlement/Transfer zamiast mutable `host_balance` jako source of truth.

Przykład:

```text
Pending = SUM(host_amount) WHERE settlement = PENDING
Available = SUM(host_amount) WHERE settlement in (AVAILABLE, TRANSFER_PENDING)
Transferred = SUM(host_amount) WHERE settlement = TRANSFERRED
```

Uwzględnij CANCELLED/REVERSED.

---

# 25. Host Finance UI

Rozszerz istniejące:

```text
/host/payments
```

lub zgodną z repo sekcję finansową.

Pokaż:

```text
Do wypłaty później
Dostępne
Przekazane do Stripe
Status konta płatniczego
```

oraz listę Settlement.

Dla każdego wpisu:

```text
Booking reference
Property
Stay dates
Guest paid
Rezervio fee
For Host
Release date
Settlement status
Transfer/Payout status
```

UI ma być biznesowe, bez eksponowania niepotrzebnych Stripe internals.

---

# 26. PlatformFee vs Stripe fee

Nie mieszaj:

```text
Rezervio PlatformFee
```

z:

```text
Stripe processing fee
```

PlatformFee pochodzi z Booking financial snapshot.

Nie buduj w tym milestone pełnego księgowego systemu kosztów Stripe, jeśli jeszcze go nie ma.

---

# 27. Sandbox-only manual release

Dla łatwego testowania możesz dodać akcję:

```text
[ Zwolnij środki teraz — sandbox ]
```

Wyłącznie gdy:

```text
NODE_ENV != production
AND Stripe mode = test
```

Akcja:
- działa per Settlement;
- wymaga ownership Hosta;
- jest idempotentna;
- używa normalnego release command i invariantów;
- nie może być aktywna w production.

---

# 28. Security

Host A nie może:

```text
czytać Settlement Host B
czytać Transfer/Payout Host B
triggerować sandbox release Host B
```

Nie loguj:

```text
Stripe secrets
bank account data
full provider objects
```

---

# 29. Database migrations

Drizzle migrations dla:

```text
booking_settlements
host_transfers
host_payouts              # jeśli potrzebne dla Connect modelu
host_transfer_reversals
required indexes/constraints
```

Minimum indexes:

```text
booking_settlements.booking_id UNIQUE
booking_settlements.host_id
booking_settlements.status
booking_settlements.release_at

host_transfers.settlement_id
host_transfers.provider_transfer_id UNIQUE WHERE NOT NULL
host_transfers.status

host_payouts.host_id
host_payouts.provider_payout_id UNIQUE
host_payouts.status

host_transfer_reversals.transfer_id
host_transfer_reversals.provider_reversal_id UNIQUE WHERE NOT NULL
```

---

# 30. API

Dodaj/rozszerz np.:

```http
GET /api/host/payments/summary
GET /api/host/settlements
GET /api/host/settlements/:id
GET /api/host/payouts
```

Sandbox-only, jeśli implementowany:

```http
POST /api/host/settlements/:id/release-now
```

Host nie może podawać arbitralnej kwoty Settlement/Transfer.

---

# 31. Tests — Settlement

Minimum:

```text
SUCCEEDED Payment + CONFIRMED Booking → exactly one Settlement
amounts from Booking snapshot
PlatformFee correct
HostAmount correct
currency correct
releaseAt correct
Property timezone correct
duplicate event does not duplicate Settlement
```

---

# 32. Tests — Release

Minimum:

```text
before releaseAt → PENDING
after releaseAt → AVAILABLE
CANCELLED/EXPIRED Booking → no release
Refund before release → no release
duplicate release job idempotent
timezone boundary correct
```

---

# 33. Tests — Transfer

Minimum:

```text
AVAILABLE + Host READY → Transfer
Host not READY → no Transfer
amount = Settlement.hostAmount
duplicate workers → one provider Transfer
Stripe retry → no duplicate
success → Settlement TRANSFERRED
failure → retry/recovery
```

---

# 34. Tests — Refund/Reversal

Before Transfer:

```text
full Refund
→ Settlement CANCELLED
→ no Transfer
```

After Transfer:

```text
full Refund
→ exactly one Reversal
→ REVERSAL_PENDING
→ successful reversal
→ REVERSED
```

---

# 35. Tests — Payout

Jeśli wspiera to faktyczny Connect model:

```text
sandbox payout observed/created
PENDING/IN_TRANSIT
PAID
FAILED
duplicate webhook safe
```

Nie wymagaj realnego bank settlement.

---

# 36. Tests — Reconciliation

Minimum:

```text
local TRANSFER_PENDING + provider succeeded → repaired
retryable provider failure → retried safely
duplicate reconciliation → no duplicate money movement
mismatch remains observable
```

---

# 37. Manual sandbox flow

Wykonaj:

```text
1. Host ma READY Stripe Connect sandbox account
2. Guest tworzy Booking
3. Guest płaci test card
4. Payment = SUCCEEDED
5. Booking = CONFIRMED
6. Settlement powstaje:
   gross
   PlatformFee
   HostAmount
   PENDING

7. Host UI pokazuje Pending

8. Użyj test clock / sandbox release
9. Settlement → AVAILABLE
10. Transfer przez normalny worker
11. Stripe Connect Transfer succeeds
12. Settlement → TRANSFERRED
13. Host UI się aktualizuje

14. Przetestuj/obserwuj sandbox Payout
15. Przetestuj payout failure, jeśli Connect model to wspiera

16. Nowy Booking: full Refund przed Transfer
17. Settlement → CANCELLED
18. brak Transfer

19. Nowy Booking: najpierw Transfer
20. potem full Refund
21. dokładnie jeden Transfer Reversal
22. Settlement → REVERSED

23. replay webhook/jobs
24. brak duplicate money movement

25. uruchom reconciliation
26. local/provider state spójny
```

---

# 38. Docs

Zaktualizuj `docs/domain-language.md` o:

```text
Payment
Settlement
PlatformFee
HostAmount
Transfer
Payout
TransferReversal
releaseAt
```

Najważniejsze:

```text
Payment != Settlement
Settlement != Transfer
Transfer != Payout
```

Zaktualizuj `docs/architecture.md` o:

```text
financial lifecycle
release policy
Stripe Connect Transfer boundary
Payout observation/control model
refund + Transfer Reversal
financial idempotency
reconciliation
BullMQ jobs
sandbox-only testing
```

Jeśli istnieje `docs/project-state.md`, zaktualizuj go po zakończeniu.

---

# 39. Quality gates

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

Financial concurrency/idempotency tests są obowiązkowe.

---

# 40. Definition of Done

## Settlement

```text
one Settlement per Booking
immutable financial snapshot
releaseAt
PENDING → AVAILABLE
Host balances
```

## Transfer

```text
Stripe sandbox
Host readiness
AVAILABLE → Transfer
stable idempotency
no duplicate transfer
success/failure/retry
TRANSFERRED
```

## Payout

```text
separate from Transfer
sandbox lifecycle observed/persisted
failed payout observable
useful Host status
```

## Refund interaction

```text
refund before Transfer → CANCELLED
refund after Transfer → exactly one Reversal
REVERSED
reconciliation
```

---

# 41. Nie akceptuj implementacji, w której

```text
Payment nazywany jest Payout
Transfer nazywany jest Payout
HostAmount pochodzi z request body
stary Booking używa aktualnej PlatformFee
Transfer wykonywany jest natychmiast po Payment bez release policy
BullMQ jest source of truth dla release
duplicate worker może stworzyć drugi Transfer
refund po Transfer ignoruje Transfer Reversal
Host A widzi finanse Host B
Stripe live key jest potrzebny do developmentu
```

---

# 42. Raport końcowy

Podaj:

## Implemented

```text
Settlement
release policy
Host balance
Stripe Transfer
Payout integration/observation
Refund interaction
Transfer Reversal
Reconciliation
Host Finance UI
tests
docs
```

## Financial verification

```text
Settlement creation: PASS/FAIL
PlatformFee snapshot: PASS/FAIL
HostAmount: PASS/FAIL
releaseAt: PASS/FAIL
PENDING → AVAILABLE: PASS/FAIL
Transfer: PASS/FAIL
duplicate Transfer protection: PASS/FAIL
Payout lifecycle: PASS/FAIL
failed Payout: PASS/FAIL
Refund before Transfer: PASS/FAIL
Refund after Transfer/Reversal: PASS/FAIL
Reconciliation: PASS/FAIL
```

## Sandbox verification

```text
Stripe test mode only: PASS/FAIL
Connect Host READY: PASS/FAIL
Transfer sandbox: PASS/FAIL
Payout sandbox: PASS/FAIL
no real money required: PASS/FAIL
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

Wskaż tylko:

> **Milestone 11: Production Hardening & Admin/Support — operational admin tools, reconciliation visibility, security hardening, observability and production readiness.**

---

# 43. Final principle

```text
PAYMENT
Guest zapłacił

SETTLEMENT
ile należy się Hostowi

TRANSFER
platforma → Stripe Connected Account Hosta

PAYOUT
Connected Account → bank Hosta
```

Sukces Payment nie oznacza natychmiastowej wypłaty Hostowi.

```text
Payment SUCCEEDED
        ↓
Settlement PENDING
        ↓
releaseAt
        ↓
AVAILABLE
        ↓
Transfer
        ↓
Connected Account
        ↓
Payout
```

Cały Milestone 10 musi dać się przetestować w Stripe sandbox bez prawdziwych pieniędzy.
