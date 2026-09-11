# Rezervio — Milestone 12: PMS / Channel Manager Connectivity — Hostaway + Channex

> Cel: zbudować pierwszą prawdziwą warstwę connectivity dla profesjonalnych Hostów i property managerów. Rezervio ma potrafić synchronizować inventory i rezerwacje z zewnętrznym systemem, bez ręcznego przepisywania kalendarzy.

Milestone obejmuje dwa różne tory:

```text
12A — Hostaway Direct
Rezervio ↔ Hostaway

12B — Channex Channel
PMS → Channex → Rezervio
```

Nie traktuj Hostaway i Channex jako dwóch identycznych providerów.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–11.

Najpierw przeczytaj tylko:

```text
CLAUDE.md
docs/domain-language.md
docs/architecture.md
docs/project-state.md        # jeśli istnieje
docs/milestone-12-pms-channel-manager-connectivity.md
```

Następnie:

1. przeanalizuj aktualny kod;
2. sprawdź istniejące: Property, Availability, AvailabilityBlock, Booking, Booking cancellation, iCal integration, BullMQ, webhooks i admin/operations;
3. uruchom istniejące testy;
4. dopiero potem rozpocznij implementację.

Nie czytaj milestone 01–11, chyba że napotkasz konkretną niejasność.

Nie przebudowuj domeny bez potrzeby.

---

# 1. Główna zasada

Rezervio pozostaje source of truth dla:

```text
Rezervio Booking
final booking state
final local availability decision
financial lifecycle
```

Zewnętrzny PMS / Channel Manager jest źródłem zewnętrznych reservation/inventory signals.

Nie twórz implicit dual source of truth.

---

# 2. Po co ta integracja

Cel biznesowy:

> Rezervio ma być dodatkowym kanałem sprzedaży, a nie dodatkowym ręcznym kalendarzem.

Przykład:

```text
external booking
        ↓
PMS / Channel Manager
        ↓
Rezervio
        ↓
Availability blocked

Rezervio Booking
        ↓
PMS / Channel Manager
        ↓
other channels see unavailable dates
```

---

# PART A — COMMON CONNECTIVITY FOUNDATION

## 3. Minimalna wspólna granica

Dodaj proste, trwałe koncepty:

```text
ExternalInventoryConnection
ExternalPropertyMapping
ExternalReservationMapping
ProviderEvent
SyncAttempt
```

Nie buduj rozbudowanego frameworka pod kilkanaście providerów.

---

## 4. Connection model

Dodaj np.:

```text
external_inventory_connections
```

Minimum:

```text
id
host_id
provider
status
external_account_id nullable
credentials_encrypted nullable
configuration_json nullable
last_successful_sync_at nullable
last_failed_sync_at nullable
last_error_code nullable
created_at
updated_at
disabled_at nullable
```

Provider:

```text
HOSTAWAY
CHANNEX
```

Status:

```text
PENDING
CONNECTED
DEGRADED
DISCONNECTED
ACTION_REQUIRED
```

Credentials:
- encrypted at rest;
- nigdy w plaintext logs;
- nigdy zwracane do frontend;
- nigdy w admin UI jako raw value.

---

## 5. Property mapping

Dodaj:

```text
external_property_mappings
```

Minimum:

```text
id
connection_id
property_id
external_property_id
external_property_name nullable
status
created_at
updated_at
```

Unique:

```text
(connection_id, property_id)
(connection_id, external_property_id)
```

---

## 6. Reservation mapping

Dodaj:

```text
external_reservation_mappings
```

Minimum:

```text
id
connection_id
provider
external_reservation_id
booking_id nullable
property_id
direction
status
created_at
updated_at
```

Direction:

```text
INBOUND
OUTBOUND
```

Unique:

```text
(connection_id, external_reservation_id)
```

---

## 7. Provider events / sync audit

Dodaj lub reuse:

```text
external_provider_events
external_sync_attempts
```

Provider event minimum:

```text
id
provider
connection_id nullable
provider_event_id
event_type
payload_hash nullable
processed_at nullable
created_at
```

Unique:

```text
(provider, provider_event_id)
```

Sync attempt minimum:

```text
id
connection_id
sync_type
status
started_at
completed_at nullable
items_processed
items_failed
error_code nullable
```

Nie zapisuj ogromnych provider payloads.

---

# PART B — AVAILABILITY RULES

## 8. Availability source

Rozszerz/reuse:

```text
AvailabilityBlock.sourceType = EXTERNAL_PROVIDER
```

Inbound reservation tworzy blokadę z powiązaniem do:
- provider;
- connection;
- external reservation id.

---

## 9. Concurrency

Wszystkie external availability writes muszą używać tego samego property-level concurrency mechanism, którego używa:
- Booking;
- BookingHold;
- iCal reconciliation;
- manual blocks.

Jeśli istnieje canonical Property advisory lock — reuse.

Nie rób blind overwrite local state.

---

# PART C — 12A HOSTAWAY DIRECT

## 10. Hostaway connection

Dodaj Host UI:

```text
/host/integrations
```

Sekcja:

```text
Hostaway
[ Połącz Hostaway ]
```

Connection flow dostosuj do faktycznie dostępnego Hostaway authentication model.

Nie hardcoduj credentials.

---

## 11. Hostaway property discovery

Po połączeniu:
- pobierz external properties;
- pokaż je Hostowi;
- pozwól jawnie mapować do Rezervio Property.

Nie auto-mapuj tylko po nazwie bez confirmation.

---

## 12. Hostaway import scope

Na pierwszą wersję:

```text
availability
reservations
reservation modifications
cancellations
```

Możesz zachować:
- guest count;
- reservation dates;
- external reference;

jeśli provider udostępnia to bezpiecznie.

Poza zakresem:
- photos;
- descriptions;
- pricing model;
- fees;
- messages;
- reviews.

---

## 13. Hostaway inbound reservation flow

```text
External channel reservation
        ↓
Hostaway
        ↓
API/webhook
        ↓
ExternalReservationMapping
        ↓
AvailabilityBlock(EXTERNAL_PROVIDER)
```

Nie twórz pełnego Rezervio Booking dla każdej external reservation bez potrzeby.

Preferuj external reservation projection + AvailabilityBlock.

---

## 14. Hostaway outbound Booking flow

Po:

```text
Rezervio Booking = CONFIRMED
```

dla mapped Property:

```text
enqueue provider reservation push
```

Operation:
- idempotent;
- retry-safe;
- deduplicated;
- nie tworzy duplicate external reservation.

---

## 15. Hostaway cancellation

Jeśli Rezervio Booking zostanie anulowany:

```text
Rezervio
 ↓
Hostaway cancellation/update
```

Nie usuwaj mappingu.

---

## 16. Hostaway sync strategy

Preferuj:

```text
webhook
+
polling/reconciliation fallback
```

Webhook = fast path.  
Polling = recovery.

Dodaj:

```text
hostaway-reconciliation
```

który porównuje active external reservations, mappings i AvailabilityBlocks.

---

# PART D — 12B CHANNEX CHANNEL

## 17. Ważna różnica

Rezervio jest tutaj:

```text
OTA / channel
```

Nie:

```text
PMS
```

Nie implementuj Channex jako kopii Hostaway adaptera.

---

## 18. Channex access gate

Przed implementacją pełnej integracji:

1. sprawdź dostępne credentials/specification;
2. sprawdź czy Rezervio ma faktyczny OTA/channel partner access;
3. sprawdź dostępne staging/test environment dla tego modelu.

Jeśli access nie jest dostępny:

```text
DO NOT invent endpoints
DO NOT report full integration as complete
```

Wtedy implementuj:

```text
technical foundation
provider boundary
mapping model
contract tests
test doubles
connection state = PARTNER_ACCESS_REQUIRED
```

---

## 19. Channex desired direction

Docelowo:

```text
PMS
 ↓
Channex
 ↓
Rezervio
```

Rezervio ma otrzymywać:
- property/inventory mapping;
- availability;
- provider reservation state;
- inne dane tylko jeśli rzeczywiście potrzebne.

Rezervio ma dostarczać:
- new Rezervio Booking;
- cancellation;
- provider acknowledgements zgodnie z rzeczywistym contractem.

---

## 20. Channex provider boundary

Dodaj:

```text
ChannexChannelProvider
```

tylko z metodami odpowiadającymi realnemu contractowi.

Nie kopiuj Hostaway interface 1:1.

---

## 21. Partner access state

Jeśli brak OTA/channel credentials:

```text
status = ACTION_REQUIRED
reason = PARTNER_ACCESS_REQUIRED
```

Host/Admin UI ma pokazywać prawdziwy stan.

---

# PART E — HOST UX

## 22. Integrations page

Dodaj:

```text
/host/integrations
```

Minimum:

```text
Hostaway
status
last sync
mapped properties

Channex
status
partner access / connected
last sync
mapped properties
```

---

## 23. Mapping UX

Flow:

```text
External Property
        ↓
Select Rezervio Property
        ↓
Confirm mapping
```

Możesz proponować match, ale Host zatwierdza.

---

## 24. Manual sync

Host może:

```text
[ Synchronizuj teraz ]
```

ale:
- uruchamia normalny async command;
- nie blokuje HTTP;
- jest idempotentny;
- rate-limited.

---

# PART F — ADMIN / OPERATIONS

## 25. Admin integration view

Rozszerz `/admin`.

Pokaż:

```text
provider
Host
connection status
last sync
mapped properties
failed syncs
provider events
reconciliation state
```

Bez raw credentials.

---

## 26. Safe admin actions

Admin może:

```text
Retry sync
Run reconciliation
Disable connection
Refresh connection status
Retry outbound reservation
```

Nie może ręcznie ustawić external success state.

---

# PART G — JOBS / WEBHOOKS

## 27. BullMQ jobs

Dodaj/reuse:

```text
external-provider-sync
external-provider-reconciliation
external-reservation-push
external-reservation-cancel
external-provider-webhook-process
```

Finite retries + exponential backoff + idempotency + final failure visibility.

---

## 28. Provider webhooks

Dodaj tylko jeśli faktycznie wspierane:

```http
POST /api/webhooks/hostaway
POST /api/webhooks/channex
```

Każdy:
- auth/signature validation zgodnie z provider contract;
- event dedup;
- persistence;
- async processing tam gdzie sensowne.

Nie wymyślaj webhook scheme.

---

# PART H — CONFLICTS

## 29. External reservation vs Rezervio Booking

Obowiązkowy race:

```text
Rezervio Booking confirmation
vs
external reservation arriving
```

Oba flow używają tego samego Property lock.

Nie może powstać double booking.

---

## 30. Outbound provider failure

Jeśli:

```text
Booking = CONFIRMED
```

ale push do provider failed:

```text
Booking pozostaje CONFIRMED
integration issue = OUTBOUND_SYNC_FAILED
retry
admin/Host visibility
```

Nie cofaj Booking automatycznie przy temporary provider outage.

---

# PART I — ICAL COEXISTENCE

## 31. iCal pozostaje wspierany

Nie usuwaj istniejącej integracji iCal.

Jeśli to samo external source jest podłączone natywnie oraz przez iCal:
- pokaż warning;
- nie wyłączaj automatycznie bez zgody Hosta;
- unikaj duplicate blocks.

---

# PART J — TESTING

## 32. Test strategy

Dla każdego providera rozróżnij:

```text
unit
contract
integration
sandbox/staging
manual E2E
```

Nie raportuj sandbox E2E, jeśli provider nie udostępnia odpowiedniego environment.

---

## 33. Hostaway tests

Minimum:

```text
connection
credential encryption
property discovery
property mapping
inbound reservation
external block
cancellation
outbound Rezervio Booking
outbound cancellation
duplicate event
retry
reconciliation
cross-Host isolation
```

Jeśli brak test environment:
- use test/partner account jeśli dostępne;
- otherwise contract tests + explicit limitation.

---

## 34. Channex tests

Jeśli OTA/channel staging access jest dostępny:

```text
connection
mapping
availability
reservation delivery
cancellation
event handling
duplicate event
reconciliation
```

Jeśli nie:

```text
provider contract tests
test doubles
PARTNER_ACCESS_REQUIRED
no fake external E2E PASS
```

---

## 35. Concurrency / idempotency

Obowiązkowo:

```text
external reservation vs Rezervio Booking confirmation
duplicate webhook
duplicate polling result
duplicate outbound job
duplicate cancellation
duplicate reconciliation
```

Brak duplicate blocks/reservations.

---

# PART K — DATABASE / API / SECURITY

## 36. Migrations

Dodaj minimalnie:

```text
external_inventory_connections
external_property_mappings
external_reservation_mappings
external_provider_events
external_sync_attempts
```

plus potrzebne indexes/constraints.

---

## 37. Host API

Przykładowo:

```http
GET  /api/host/integrations
POST /api/host/integrations/hostaway/connect
GET  /api/host/integrations/:id/properties
POST /api/host/integrations/:id/mappings
POST /api/host/integrations/:id/sync
DELETE /api/host/integrations/:id/mappings/:mappingId
```

Channex endpointy tylko zgodnie z realnym access mode.

---

## 38. Security

Nie loguj:
- API keys;
- secrets;
- auth headers;
- webhook secrets.

Host A nie może:
- zobaczyć Host B connection;
- mapować Host B Property;
- synchronizować Host B account;
- widzieć external reservation metadata Host B.

Jeśli provider config zawiera URL:
- allowlist provider domains;
- brak arbitrary server-side fetch.

---

# PART L — DOCS

## 39. Domain language

Zaktualizuj `docs/domain-language.md` o:

```text
ExternalInventoryConnection
ExternalPropertyMapping
ExternalReservationMapping
ExternalReservation
```

Provider-specific nazw nie dodawaj jako core domain.

---

## 40. Architecture docs

Zaktualizuj `docs/architecture.md` o:

```text
external connectivity boundary
Hostaway direct integration
Channex OTA/channel integration
source-of-truth rules
availability locking
webhook + polling
reconciliation
provider idempotency
iCal coexistence
```

---

## 41. Project state

Jeśli istnieje `docs/project-state.md`, zaktualizuj:

```text
Milestone 12 completed
Hostaway integration status
Channex integration status
partner access limitations
```

Nie wpisuj `Channex complete`, jeśli partner access nie istnieje.

---

# PART M — MANUAL FLOW

## 42. Hostaway manual flow

Jeśli environment/access dostępne:

```text
1. Connect Hostaway
2. Fetch external properties
3. Map one Property
4. Sync
5. Create external reservation
6. Verify EXTERNAL_PROVIDER AvailabilityBlock
7. Cancel external reservation
8. Verify reconciliation
9. Create + confirm Rezervio Booking
10. Verify outbound reservation
11. Cancel Rezervio Booking
12. Verify outbound cancellation
13. Replay duplicates
14. Verify no duplicate effects
```

---

## 43. Channex manual flow

Jeśli OTA/channel staging access dostępny:

```text
1. Connect staging credentials
2. Map Property
3. Receive inventory/availability
4. Receive reservation/event
5. Deliver Rezervio Booking
6. Verify cancellation
7. Replay duplicate event
8. Run reconciliation
```

Jeśli brak access:

```text
1. Verify PARTNER_ACCESS_REQUIRED
2. Verify contract/test-double suite
3. Verify no undocumented endpoints invented
4. Document exact missing onboarding/certification step
```

---

# PART N — QUALITY

## 44. Quality gates

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

## 45. Definition of Done — Common

```text
connection model
property mapping
reservation mapping
provider event dedup
sync audit
BullMQ jobs
Host UI
admin visibility
security
reconciliation
conflict-safe Availability
```

---

## 46. Definition of Done — Hostaway

Minimum:

```text
Hostaway adapter
connection
property discovery/mapping
inbound reservation sync
availability blocking
outbound Rezervio Booking
cancellation
webhook/polling or equivalent
reconciliation
idempotency
```

External E2E tylko jeśli provider access/environment faktycznie na to pozwala.

---

## 47. Definition of Done — Channex

Jeśli OTA/channel access dostępny:

```text
real staging integration
mapping
inventory/reservation flow
cancellation
events
reconciliation
```

Jeśli NIE:

```text
correct channel-oriented boundary
connection/status model
mapping foundation
contract tests
test doubles
PARTNER_ACCESS_REQUIRED
clear blocker documented
```

Nie fałszuj E2E completion.

---

## 48. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
Hostaway i Channex są traktowane jako identyczne API
provider credentials są plaintext
external reservation omija Property lock
duplicate event tworzy duplicate block
outbound retry tworzy duplicate reservation
provider failure automatycznie anuluje CONFIRMED Booking
iCal zostaje usunięty
Channex undocumented endpoints są wymyślone
brak partner access jest raportowany jako integration complete
```

---

# 49. Raport końcowy

## Common connectivity

```text
Connections: PASS/FAIL
Property mapping: PASS/FAIL
Reservation mapping: PASS/FAIL
Provider event idempotency: PASS/FAIL
Reconciliation: PASS/FAIL
Concurrency protection: PASS/FAIL
Admin visibility: PASS/FAIL
Host UI: PASS/FAIL
```

## Hostaway

```text
Connection: PASS/FAIL
Property discovery: PASS/FAIL
Mapping: PASS/FAIL
Inbound reservation: PASS/FAIL
Availability block: PASS/FAIL
Outbound Booking: PASS/FAIL
Cancellation: PASS/FAIL
Webhook/polling: PASS/FAIL
Reconciliation: PASS/FAIL
External E2E: PASS/FAIL/NOT AVAILABLE
```

## Channex

```text
OTA/channel access: AVAILABLE / PARTNER_ACCESS_REQUIRED
Connection: PASS/FAIL/NOT AVAILABLE
Mapping: PASS/FAIL
Inventory flow: PASS/FAIL/NOT AVAILABLE
Reservation flow: PASS/FAIL/NOT AVAILABLE
Cancellation: PASS/FAIL/NOT AVAILABLE
Webhook/events: PASS/FAIL/NOT AVAILABLE
Reconciliation: PASS/FAIL/NOT AVAILABLE
Contract tests: PASS/FAIL
```

## Security

```text
Credential encryption: PASS/FAIL
Cross-Host isolation: PASS/FAIL
Webhook validation: PASS/FAIL
Sensitive log redaction: PASS/FAIL
```

## Quality

```text
lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual Hostaway flow: PASS/FAIL/NOT AVAILABLE
manual Channex flow: PASS/FAIL/NOT AVAILABLE
```

## Important decisions
Maksymalnie 5.

## Known limitations
Tylko realne.

## External access blockers
Wypisz konkretnie:
- Hostaway partner/test access;
- Channex OTA/channel partner access;
- certification requirements.

## Next milestone

Nie implementuj.

Wskaż tylko:

> **Milestone 13: Reviews & Post-Stay — verified Guest reviews after completed stays, Host/property ratings, moderation basics and post-stay notification.**

---

# 50. Final principle

Docelowo:

```text
Direct PMS:
Hostaway
    ↕
Rezervio

Connectivity layer:
many PMS
   ↓
Channex
   ↓
Rezervio
```

Najważniejsze:

```text
no double booking
no duplicate reservations
idempotent sync
conflict-safe Availability
webhook + reconciliation
honest provider-access status
```

Nie udawaj integracji tam, gdzie partner/provider nie udostępnił jeszcze potrzebnego API lub staging access.
