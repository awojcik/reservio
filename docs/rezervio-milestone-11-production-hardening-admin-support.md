# Rezervio — Milestone 11: Production Hardening & Admin/Support

> Cel: utwardzić istniejący system, dodać podstawowe narzędzia administracyjne i operacyjne oraz poprawić observability i bezpieczeństwo — bez przechodzenia jeszcze na realne płatności i bez traktowania tego milestone jako finalnej produkcyjnej wersji.

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–10.

Najpierw przeczytaj tylko:

```text
CLAUDE.md
docs/domain-language.md
docs/architecture.md
docs/project-state.md        # jeśli istnieje
docs/milestone-11-production-hardening-admin-support.md
```

Następnie:
1. przeanalizuj aktualny kod;
2. uruchom istniejące testy;
3. przeanalizuj obecny model auth, admin/support, jobs, Stripe, iCal, notifications, payments, settlements i payouts;
4. dopiero potem rozpocznij implementację.

Nie czytaj milestone 01–10, chyba że trafisz na konkretną niejasność wymagającą historycznego kontekstu.

## 1. Bardzo ważne: to nie jest jeszcze final production release

Milestone 11 NIE oznacza:

```text
production launch
live Stripe
real money
real Host payouts
final security certification
final compliance sign-off
```

Stripe nadal działa wyłącznie w:

```text
sandbox / test mode
```

Tak jak w Milestone 08–10.

Nie włączaj:
- `STRIPE_LIVE_KEY`;
- real bank payouts;
- real card charges.

Nie twórz procesu migracji na live Stripe.

## 2. Co oznacza "Production Hardening" w tym milestone

W tym projekcie oznacza:

```text
system jest bardziej odporny
system jest lepiej obserwowalny
support może diagnozować problemy
są bezpieczne narzędzia do retry/reconciliation
authorization jest sprawdzony
jobs są widoczne
błędy finansowe są widoczne
config jest rozdzielony na env
```

Nie oznacza:

```text
gotowy do bezwarunkowego public launch z realnymi pieniędzmi
```

# PART A — ADMIN / SUPPORT

## 3. Admin role

Dodaj prosty i jawny model dostępu administracyjnego.

Preferuj istniejący `User` + role/permissions.

Minimum:

```text
ADMIN
```

lub, jeśli architektura już ma role:

```text
SUPPORT
ADMIN
```

Nie twórz osobnego systemu użytkowników admin.

## 4. Admin authorization

Wszystkie `/admin/*` endpointy i strony:

```text
require authenticated User
require ADMIN/SUPPORT permission
```

Brak roli:

```text
403
```

Nie polegaj wyłącznie na ukryciu linku w UI.

## 5. Admin root

Dodaj:

```text
/admin
```

Minimalny dashboard:

```text
Search
Operational Issues
Recent Bookings
Failed Jobs
Financial Alerts
Calendar Sync Issues
Notification Failures
```

Nie buduj rozbudowanego BI dashboard.

## 6. Global admin search

Support musi móc wyszukać po:

```text
Booking reference
User email
Host email
Property name
Property ID
Booking ID
Payment ID
Settlement ID
Transfer ID
Payout ID
Refund ID
```

Dodaj jeden prosty search endpoint/read model, np.:

```http
GET /api/admin/search?q=...
```

## 7. Admin Booking view

Dodaj:

```text
/admin/bookings/:id
```

Pokaż:

```text
Booking status
Guest
Host
Property
Stay dates
Payment
Refund
Settlement
Transfer
Payout
Availability linkage
Messages count
Notifications
Booking events / audit
```

Celem jest diagnoza całego lifecycle.

## 8. Admin User / Host / Property views

User:
- ID;
- email;
- name;
- roles;
- Host profile;
- Guest bookings;
- createdAt;
- session/security summary.

Nie pokazuj password hash ani session secrets.

Host:
- properties;
- Stripe Connect readiness;
- settlements;
- transfers;
- payouts;
- failed operations.

Property:
- status;
- Host;
- availability summary;
- iCal sync;
- active bookings;
- StayInformation configured?;
- SensitiveAccess configured?.

Nie pokazuj plaintext door code.

# PART B — SAFE OPERATIONAL ACTIONS

## 9. Zasada dla manual actions

Admin/support NIE może dowolnie zmieniać stanów domenowych.

Nie wolno dodawać przycisków typu:

```text
Set Booking CONFIRMED
Set Payment SUCCEEDED
Set Settlement TRANSFERRED
Set Payout PAID
Edit Host balance
```

Manual action ma uruchamiać istniejący domain command / retry / reconciliation.

## 10. Bezpieczne actions

Dodaj tylko jawnie bezpieczne operacje:

```text
Retry notification
Retry refund
Retry transfer
Run payment reconciliation
Run settlement reconciliation
Run payout reconciliation
Retry iCal sync
Refresh Stripe Connect status
Re-run failed BullMQ job
```

Każda akcja:
- authorization;
- audit;
- idempotency;
- nie omija invariants.

## 11. Admin action audit

Dodaj tabelę np.:

```text
admin_actions
```

Minimum:

```text
id
admin_user_id
action_type
target_type
target_id
status
metadata_json nullable
created_at
completed_at nullable
```

Bez sekretów w metadata.

# PART C — OPERATIONAL ISSUES

## 12. Operational Issues

Preferuj read model/query zamiast ręcznie utrzymywanej listy incydentów.

Kategorie:

```text
PAYMENT
REFUND
SETTLEMENT
TRANSFER
PAYOUT
ICAL
NOTIFICATION
JOB
WEBHOOK
```

Admin musi widzieć co najmniej:

```text
Payment succeeded but Booking not confirmed
Refund pending/failed
Settlement stuck in PENDING past releaseAt
Settlement AVAILABLE but Host not READY
Transfer failed
Transfer pending too long
Reversal failed
Payout failed
Reconciliation mismatch
failed/unprocessed webhook
failed notification
stale/failed iCal
failed BullMQ job
```

Nie pokazuj raw sensitive provider payload.

# PART D — OBSERVABILITY

## 13. Correlation IDs

Każdy incoming HTTP request powinien mieć:

```text
requestId
```

Structured logs powinny umożliwiać korelację.

## 14. Structured logging fields

Tam gdzie relewantne:

```text
requestId
userId
hostId
bookingId
bookingReference
propertyId
paymentId
settlementId
transferId
payoutId
refundId
jobId
providerEventId
```

Nie loguj:
- passwords;
- access codes;
- Wi-Fi passwords;
- Stripe secrets;
- webhook secrets;
- client secrets;
- card data.

## 15. Error taxonomy

Dodaj spójne application error codes dla nowych/operacyjnych flow, np.:

```text
ADMIN_FORBIDDEN
PAYMENT_PROVIDER_ERROR
PAYMENT_INTEGRITY_ERROR
SETTLEMENT_NOT_READY
HOST_PAYMENT_ACCOUNT_NOT_READY
TRANSFER_FAILED
REFUND_FAILED
ICAL_SYNC_FAILED
```

Nie musisz migrować całej aplikacji tylko po to, by ujednolicić stare błędy.

## 16. Health / readiness

Rozszerz:

```http
GET /health
GET /ready
```

Minimum:
- API process;
- PostgreSQL;
- Redis.

Rozróżnij liveness i readiness.

Nie wykonuj kosztownych Stripe/iCal calls na każdy health request.

# PART E — SECURITY HARDENING

## 17. Auth review

Przejrzyj istniejący auth i sprawdź:
- opaque server sessions;
- logout invalidation;
- session expiry;
- cross-user isolation;
- cross-Host isolation.

Nie migruj do JWT bez potrzeby.

## 18. Cookie security

Dla production-like config:

```text
HttpOnly = true
Secure = true
SameSite = Lax lub Strict zgodnie z flow
```

Local development ma nadal działać.

## 19. CSRF / Origin protection

Dla cookie-based auth zastosuj adekwatną ochronę dla state-changing requests:
- SameSite;
- Origin/Referer validation;
- CSRF token tylko jeśli rzeczywiście potrzebny.

Nie dodawaj ciężkiego frameworka bez potrzeby.

## 20. Rate limiting

Dodaj rozsądny rate limiting co najmniej dla:

```text
login
register
password-related endpoints
Guest booking access
message send
payment create
admin search
```

Nie blokuj Stripe webhooków w sposób, który może powodować utratę eventów.

## 21. Login brute-force protection

Minimum:

```text
per IP
+
per identifier/email
```

z temporary cooldown.

Nie ujawniaj, czy email istnieje.

## 22. CORS

W production-like config:
- jawna allowlist;
- bez `*` z credentials.

Localhost dev ma działać.

## 23. Security headers

Dodaj/zweryfikuj:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
frame-ancestors / X-Frame-Options
Permissions-Policy
HSTS tylko dla poprawnego HTTPS
```

CSP nie może zepsuć Stripe Elements.

## 24. Input validation / SQL safety

Przejrzyj:
- admin search;
- messages;
- Property fields;
- StayInformation;
- URLs;
- pagination;
- sorting;
- filters.

Nie przekazuj user input bezpośrednio do raw SQL.

## 25. Sensitive log redaction

Redact co najmniej:

```text
Authorization
Cookie
password
accessCode
wifiPassword
Stripe secret
clientSecret
webhook secret
```

## 26. Environment validation

Waliduj env przy starcie.

Rozróżnij:

```text
development
test
staging-like
production-like
```

Nie wprowadzaj jeszcze finalnego production deployment workflow.

# PART F — STRIPE SANDBOX ONLY

## 27. Stripe pozostaje sandbox

W całym Milestone 11:

```text
Stripe = sandbox/test mode
```

Nie dodawaj wymogu:
- live account;
- live onboarding;
- real bank account;
- real payouts.

## 28. Guard against accidental live Stripe

W non-production environments, jeśli Stripe key wygląda jak live:

```text
fail startup
```

Jeśli odpowiedni guard już istnieje — reuse.

## 29. Admin Stripe view

Admin widzi:

```text
STRIPE TEST MODE
Connect readiness
Payment status
Settlement status
Transfer status
Payout status
Refund status
last reconciliation
```

Wyraźny badge:

```text
STRIPE TEST MODE
```

## 30. No Go Live

Nie implementuj:
- switch test → live;
- "Enable live payments";
- UI do przechowywania live API keys.

# PART G — JOBS / RETRIES / RECONCILIATION

## 31. Job registry

Zbierz istniejące job types w jednym czytelnym miejscu dokumentacyjnym/technicznym, np.:

```text
ical-sync
hold-expiration
booking-request-expiration
notification-send
payment-refund
payment-provider-cancel
stay-instructions-ready
sensitive-access-ready
stay-checkout-reminder
booking-complete
settlement-release
settlement-transfer
financial-reconciliation
```

Nie twórz nowego scheduler frameworka.

## 32. Retry policy

Sprawdź:
- attempts;
- exponential backoff;
- idempotency;
- final failure visibility.

Bez nieskończonych retry.

## 33. Reconciliation dashboard

Admin widzi:
- last run;
- entities checked;
- mismatches;
- repaired;
- failed.

## 34. Reconciliation trigger

Admin może uruchomić normalny command:

```text
payment
settlement
transfer
payout
all
```

# PART H — ADMIN UI

## 35. Admin UI

UI:
- proste;
- funkcjonalne;
- spójne z Rezervio;
- bez redesignu produktu.

Navigation minimum:

```text
Dashboard
Search
Bookings
Financial Operations
Jobs
iCal
Notifications
```

## 36. Admin tables

Wymagane:
- pagination;
- filters;
- useful sorting;
- server-side querying;
- brak N+1.

## 37. Status badges

Ograniczona liczba stanów wizualnych:

```text
OK
Pending
Warning
Failed
```

# PART I — DATABASE / API

## 38. Database additions

Dodaj tylko jeśli potrzebne:

```text
admin_actions
```

oraz minimalne indeksy/read models.

Nie kopiuj Booking/Payment/Settlement tylko pod panel Admin.

## 39. Indeksy

Najpierw sprawdź istniejące.

Rozważ zgodnie z realnymi query patterns:

```text
bookings.reference
payments.status
refunds.status
booking_settlements.status
booking_settlements.release_at
host_transfers.status
host_payouts.status
external calendars sync status/time
notification delivery status
admin_actions.created_at
```

## 40. Admin API

Przykładowo:

```http
GET /api/admin/dashboard
GET /api/admin/search?q=
GET /api/admin/bookings/:id
GET /api/admin/users/:id
GET /api/admin/hosts/:id
GET /api/admin/properties/:id

GET /api/admin/operations
GET /api/admin/jobs
GET /api/admin/notifications
GET /api/admin/ical

POST /api/admin/actions/retry-job
POST /api/admin/actions/retry-notification
POST /api/admin/actions/retry-refund
POST /api/admin/actions/retry-transfer
POST /api/admin/actions/reconcile
POST /api/admin/actions/ical-resync
```

Dostosuj nazwy do istniejącego API style.

# PART J — TESTS

## 41. Admin authorization tests

Minimum:

```text
normal User → denied
Host → denied
Guest → denied
Admin → allowed
admin API server-side guarded
```

## 42. Safe actions tests

Minimum:

```text
retry notification uses normal pipeline
retry transfer uses normal command
reconciliation idempotent
iCal resync uses existing flow
actions audited
```

## 43. Operational issue tests

Minimum:

```text
failed transfer visible
failed refund visible
stuck settlement visible
failed notification visible
stale iCal visible
failed job visible
healthy entity not incorrectly flagged
```

## 44. Security tests

Minimum:

```text
login rate limit
admin rate limit
CORS allowlist
cookie flags in production-like env
invalid Origin/CSRF blocked where applicable
sensitive fields redacted
Stripe Elements works with CSP
```

## 45. Health tests

Minimum:

```text
liveness works
readiness true with dependencies
readiness false when DB unavailable
readiness false when required Redis unavailable
```

## 46. Stripe sandbox guard tests

Minimum:

```text
test key accepted
live key rejected in dev/test
admin shows TEST MODE
no live flow introduced
```

# PART K — MANUAL FLOW

## 47. Manual admin flow

Wykonaj:

```text
1. Login as Admin
2. Open /admin
3. Search Booking by reference
4. Open Booking lifecycle
5. Verify Payment/Refund/Settlement/Transfer/Payout visible
6. Verify STRIPE TEST MODE badge

7. Prepare failed notification
8. Verify issue visible
9. Retry from Admin
10. Verify normal notification flow
11. Verify admin action audit

12. Prepare failed/retryable Transfer sandbox scenario
13. Verify issue
14. Trigger retry
15. Verify idempotent result

16. Prepare failed/stale iCal
17. Trigger resync
18. Verify status

19. Run reconciliation
20. Verify result summary

21. Login as normal Host
22. Verify /admin forbidden
```

# PART L — DOCS

## 48. Architecture docs

Zaktualizuj `docs/architecture.md` o:

```text
admin/support boundary
operational actions
audit
structured logging
health/readiness
rate limiting
security headers
environment config
reconciliation visibility
Stripe sandbox-only constraint
```

## 49. Project state

Jeśli istnieje `docs/project-state.md`, zaktualizuj:

```text
Milestone 11 completed
Stripe still TEST/SANDBOX
Not yet final production release
```

## 50. README

Dodaj krótko:
- Admin local setup;
- jak nadać ADMIN lokalnie;
- jak otworzyć `/admin`;
- jak zasymulować failure;
- jak uruchomić reconciliation;
- Stripe remains test mode.

Bez sekretów.

# PART M — QUALITY

## 51. Quality gates

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

## 52. Definition of Done — Admin

```text
Admin auth
/admin
global search
Booking lifecycle view
Host/User/Property views
operational issues
safe retry actions
audit
```

## 53. Definition of Done — Observability

```text
requestId
structured logs
financial issue visibility
job visibility
iCal visibility
notification failures
reconciliation status
health/readiness
```

## 54. Definition of Done — Security

```text
admin authorization
rate limiting
CORS
cookie hardening
CSRF/origin protection where needed
security headers
sensitive log redaction
env validation
```

## 55. Definition of Done — Stripe

Musi pozostać:

```text
TEST / SANDBOX ONLY
```

oraz:

```text
admin clearly sees test mode
no live credentials required
no live charges
no real payout
```

## 56. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
/admin chroniony tylko frontendowo
support ręcznie ustawia Payment SUCCEEDED
support ręcznie ustawia Settlement TRANSFERRED
manual retry omija domain commands
live Stripe jest wymagany
admin pokazuje sensitive access code
logs zawierają secrets
admin dashboard robi N+1
failed jobs są niewidoczne
STRIPE TEST MODE nie jest jasno oznaczony
```

# 57. Raport końcowy

Po zakończeniu podaj:

## Implemented

```text
Admin/Support
Global Search
Operational Issues
Safe Actions
Audit
Observability
Health/Readiness
Security Hardening
Reconciliation visibility
Stripe sandbox guard
Docs
```

## Admin routes
Wypisz strony i API.

## Security verification

```text
Admin auth: PASS/FAIL
Cross-role isolation: PASS/FAIL
Rate limiting: PASS/FAIL
CORS: PASS/FAIL
Cookie hardening: PASS/FAIL
CSRF/origin protection: PASS/FAIL
Sensitive log redaction: PASS/FAIL
Security headers: PASS/FAIL
```

## Operations verification

```text
Payment issues: PASS/FAIL
Refund issues: PASS/FAIL
Settlement issues: PASS/FAIL
Transfer issues: PASS/FAIL
Payout issues: PASS/FAIL
iCal issues: PASS/FAIL
Notification issues: PASS/FAIL
Failed jobs: PASS/FAIL
Reconciliation trigger: PASS/FAIL
Admin action audit: PASS/FAIL
```

## Stripe mode

```text
Sandbox/test only: PASS/FAIL
Live credentials not required: PASS/FAIL
Live key blocked in dev/test: PASS/FAIL
Admin TEST MODE badge: PASS/FAIL
```

## Quality

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual admin flow: PASS/FAIL
```

## Important decisions
Maksymalnie 5.

## Known limitations
Tylko realne.

## Next milestone

Nie implementuj.

Wskaż tylko:

> **Milestone 12: PMS / Channel Manager Integration — first external inventory provider behind `InventoryProvider`, availability/reservation synchronization, webhook/polling and conflict-safe reconciliation.**

# 58. Final principle

Milestone 11 ma zrobić z Rezervio system znacznie bardziej operacyjny i bezpieczny, ale nie udawać, że produkt jest już finalnie produkcyjny.

Status po M11:

```text
Core marketplace complete
+
admin/support tools
+
security hardening
+
observability
+
reconciliation
+
Stripe SANDBOX
```

Nie:

```text
real-money production launch
```

Stripe pozostaje w sandboxie/test mode do czasu osobnej, świadomej decyzji o live readiness.
