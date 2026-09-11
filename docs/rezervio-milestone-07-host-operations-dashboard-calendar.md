# Rezervio — Milestone 07: Host Operations Dashboard & Calendar UX

> Cel: zamienić Host area w praktyczne centrum codziennej pracy gospodarza — z informacją co wymaga działania, co dzieje się dziś i w najbliższych dniach oraz z jednym spójnym widokiem kalendarza Property, Booking i blokad.

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–06.

Najpierw:
1. przeanalizuj aktualny Host dashboard, Property, Availability, ExternalCalendar, Booking, BookingHold, Notifications i auth;
2. uruchom istniejące testy;
3. przeczytaj `docs/domain-language.md`, `docs/architecture.md` oraz wszystkie milestone 01–07;
4. dopiero potem rozpocznij implementację.

Nie zmieniaj istniejących invariantów Booking/Availability. Nie implementuj Payments.

## 1. Główny rezultat biznesowy

Po wejściu na `/host` Host powinien od razu wiedzieć:

```text
Co wymaga mojej uwagi?
Kto przyjeżdża dziś?
Kto wyjeżdża dziś?
Jakie requests czekają na odpowiedź?
Jakie pobyty są najbliższe?
Czy któryś iCal ma problem?
Czy któreś Property jest draft/suspended/not ready?
Jak wygląda zajętość wszystkich Property?
```

## 2. Zakres

Zaimplementuj:

```text
Host operations dashboard
Attention Required
Today
Arrivals
Departures
Pending Requests
Upcoming Stays
Property overview
iCal sync health
Unified multi-property calendar
Property filtering
Booking / block source visualization
Host Booking search/filter
quick operational actions
responsive UX
OpenAPI updates
tests
docs
```

## 3. Poza zakresem

Nie implementuj:

```text
Payments
Stripe
Refunds
Payouts
Revenue dashboard
financial charts
occupancy analytics
housekeeping workflow
cleaning staff accounts
smart locks
chat
SMS
native PMS API
dynamic pricing
reviews
AI assistant
advanced reports
Host organizations / roles
```

## 4. Dashboard ma być action-first

Nie buduj dashboardu z vanity metrics.

Priorytet:

```text
ACTIONABLE
```

nad:

```text
ANALYTICS
```

Preferowana kolejność `/host`:

```text
1. Attention Required
2. Today
3. Pending Requests
4. Upcoming Stays
5. Properties Overview
6. Calendar Sync Health
```

## 5. Attention Required

Backend buduje computed operational projection. Nie twórz osobnej tabeli dashboard state.

Typy minimum:

```text
BOOKING_REQUEST_PENDING
BOOKING_REQUEST_EXPIRING_SOON
ICAL_SYNC_FAILED
ICAL_SYNC_STALE
PROPERTY_DRAFT
PROPERTY_SUSPENDED
PROPERTY_NOT_READY_FOR_PUBLISH
```

DTO np.:

```json
{
  "type": "BOOKING_REQUEST_PENDING",
  "severity": "ACTION",
  "propertyId": "...",
  "bookingId": "...",
  "title": "Nowa prośba o rezerwację",
  "description": "Sea View · 12–16 września",
  "actionUrl": "/host/bookings/...",
  "occurredAt": "..."
}
```

Severity:

```text
ACTION
WARNING
INFO
```

Sortuj po urgency, deadline i czasie zdarzenia.

## 6. Dashboard API

Dodaj jeden zoptymalizowany endpoint:

```http
GET /api/host/dashboard
```

Nie rób 15 osobnych requestów z frontendu.

Response może zawierać:

```text
attention
today
pendingRequests
upcomingStays
properties
calendarSync
```

## 7. Today / Arrivals / Departures

Arrival:

```text
Booking.status = CONFIRMED
AND checkIn = Property-local today
```

Departure:

```text
Booking.status = CONFIRMED
AND checkOut = Property-local today
```

Używaj `Property.timeZone`, nie jednej globalnej timezone.

Today item minimum:

```text
Guest name
Property
Booking reference
check-in/check-out
guest count
status
CTA
```

Nie wymyślaj godzin check-in/out, jeśli nie istnieją w modelu.

## 8. Pending Requests

Pokaż:

```text
PENDING_HOST_APPROVAL
```

Sort:

```text
host_response_deadline_at ASC
```

Minimum:

```text
Property
Guest
Stay
total price
deadline
time remaining
Accept
Reject
```

Quick actions muszą reuse istniejące:

```text
acceptBookingRequest
rejectBookingRequest
```

Nie duplikuj state machine.

## 9. Upcoming Stays

Pokaż najbliższe:

```text
CONFIRMED
checkIn > local today
```

Sort:

```text
checkIn ASC
```

Preferuj np. 10 najbliższych albo 14 dni — w jednym miejscu, nie hardcoduj wielu różnych limitów.

## 10. Property Overview

Minimum counts:

```text
Published
Draft
Suspended
Total
```

Kliknięcie prowadzi do `/host/properties`.

Draft warning ma reuse istniejący `publishReadiness`.

## 11. Calendar Sync Health

Pokaż stan ExternalCalendar:

```text
healthy
failed
stale
disabled
```

Jeśli `stale` jest już zdefiniowane w Milestone 03, reuse tę samą logikę.

Nie twórz drugiej definicji w frontendzie.

Summary np.:

```text
5 aktywnych
4 aktualne
1 wymaga uwagi
```

Warning prowadzi do właściwego Property calendar.

## 12. Unified Host Calendar

Dodaj:

```text
/host/calendar
```

Ma pokazywać wszystkie Property Host w jednym miejscu.

Nie usuwa istniejącego:

```text
/host/properties/[id]/calendar
```

## 13. Calendar content

Pokazuj:

```text
BOOKING
active BOOKING_HOLD
HOST_BLOCK
EXTERNAL_CALENDAR
```

Expired Hold nie może być aktywnym eventem.

## 14. Calendar UX

Minimum:

```text
Month
Property filter
```

Preferowane także:

```text
List
```

Dla wielu Property preferuj praktyczny układ:

```text
rows = Properties
columns = dates
```

lub inny occupancy-style calendar.

Nie buduj Google Calendar clone.

## 15. Calendar source labels

Nie pokazuj samych enumów.

Przykład:

```text
BOOKING          → Rezerwacja
BOOKING_HOLD     → Tymczasowo zablokowane
HOST_BLOCK       → Ręczna blokada
EXTERNAL_CALENDAR → Booking.com / Airbnb / iCal
```

Nie używaj koloru jako jedynego rozróżnienia.

## 16. External calendar privacy

Nie pokazuj Hostowi Guest-like PII z external iCal SUMMARY.

Pokazuj np.:

```text
Niedostępne — Booking.com
```

## 17. Manual blocks from unified calendar

Host może:
- zaznaczyć zakres;
- utworzyć manual block;
- odblokować manual range.

Reuse istniejące Availability endpoints/services.

Nie twórz nowej logiki overlap/split.

## 18. Host Calendar API

Dodaj:

```http
GET /api/host/calendar
```

Query:

```text
from
to
propertyId optional
```

Response grupowany po Property.

Np.:

```json
{
  "from": "2026-09-01",
  "to": "2026-10-01",
  "properties": [
    {
      "id": "...",
      "title": "...",
      "timeZone": "Europe/Warsaw",
      "events": []
    }
  ]
}
```

## 19. Host Calendar Event DTO

Minimum:

```text
id
type
startDate
endDate
label
bookingReference nullable
guestName nullable
sourceLabel nullable
expiresAt nullable
```

Dla EXTERNAL_CALENDAR:

```text
guestName = null
```

## 20. Calendar range validation

Wymagaj:

```text
to > from
```

Ogranicz pojedynczy request do rozsądnego zakresu, np. max 366 dni.

## 21. Avoid N+1

Nie wykonuj:
- query per day;
- query per Property;
- query per Booking.

Użyj batch SQL/read projections.

## 22. Host Bookings improvements

Rozszerz `/host/bookings` o:

```text
status filter
Property filter
date range
Guest/reference search
pagination
```

Search minimum po:

```text
booking reference
Guest name
Guest email
```

Tylko w Host-owned Booking.

PostgreSQL wystarczy.

## 23. Booking list sorts

Preferowane:

```text
NEWEST
STAY_DATE_ASC
STAY_DATE_DESC
ACTION_REQUIRED
```

`ACTION_REQUIRED` priorytetyzuje m.in. `PENDING_HOST_APPROVAL`.

## 24. Quick operational actions

Z list/dashboard/detail reuse istniejące:

```text
Accept
Reject
Cancel
```

Nie dodawaj nowych Booking transitions.

## 25. Read models

Możesz dodać:

```text
HostOperationsService
HostCalendarQueryService
```

Dashboard i calendar są read-side projections.

Nie twórz:

```text
host_dashboard_state
```

jako source of truth.

## 26. Database

Ten milestone powinien wymagać minimalnych zmian schema.

Sprawdź indeksy dla:

```text
bookings.host_id
bookings.status
bookings.check_in
bookings.check_out
bookings.host_response_deadline_at
availability_blocks.property_id
external_calendars.property_id
external_calendars.status
properties.host_id
properties.status
```

Dodaj tylko brakujące, realnie używane indexy.

## 27. EXPLAIN sanity

Wykonaj `EXPLAIN ANALYZE` dla reprezentatywnych:
- dashboard;
- month calendar;
- Booking filter/search.

Nie micro-optimize, ale uniknij oczywistych full scans/N+1.

## 28. Security

Każdy Host endpoint musi używać authenticated Host identity.

Testuj:

```text
Host A dashboard has no Host B data
Host A calendar has no Host B data
Host A booking search has no Host B data
foreign propertyId cannot leak data
```

Na overview pokazuj Guest name, ale email/phone dopiero tam, gdzie są potrzebne.

## 29. Responsive UX

Sprawdź:
- desktop;
- tablet;
- mobile.

Na mobile priorytet:

```text
Attention
Today
Pending
Upcoming
```

Unified calendar może używać:
- list mode;
- Property filter;
- horizontal scroll.

Nie przenoś desktop grid 1:1.

## 30. Empty/loading/error states

Obsłuż:

```text
No Property
No Bookings
No Attention
No Calendar Events
Loading
API error
Action error
```

Nie fallbackuj do mocków.

## 31. Design

Zachowaj Rezervio design language:

```text
Deep Pine
Coral
Cream
existing typography
existing spacing
```

Nie twórz generic SaaS/admin dashboard.

Attention ma być bardziej widoczne niż neutralne statystyki, ale bez agresywnej czerwieni wszędzie.

## 32. Tests — Dashboard

Minimum:

```text
Host sees only own data
pending request appears
expiring request prioritized
draft warning appears
failed iCal warning appears
healthy state no false warning
today arrival appears
today departure appears
upcoming sorted
timezone correctness
```

## 33. Tests — Calendar

Minimum:

```text
BOOKING appears
active BOOKING_HOLD appears
expired Hold absent
HOST_BLOCK appears
EXTERNAL_CALENDAR appears
external PII hidden
property filter works
range validation
cross-Host isolation
```

## 34. Tests — Booking filters

Minimum:

```text
status
Property
date range
reference
Guest name
Guest email
pagination
cross-Host isolation
```

## 35. Tests — Quick actions

Jeśli dashboard ma Accept/Reject:

```text
uses existing commands
invalid transition rejected
foreign Host rejected
dashboard reflects new state
```

## 36. Manual end-to-end flow

Wykonaj:

```text
1. Login as Host with multiple Properties
2. Open /host
3. Verify Attention
4. Verify pending request and deadline
5. Accept/Reject
6. Verify dashboard updates

7. Create failed/stale iCal state
8. Verify warning
9. Navigate to Property calendar

10. Open /host/calendar
11. Verify multiple Properties
12. Verify HOST_BLOCK
13. Verify EXTERNAL_CALENDAR
14. Verify BOOKING/active Hold fixtures
15. Filter Property
16. Create manual block
17. Remove manual block

18. Open /host/bookings
19. Search reference
20. Search Guest
21. Filter Property/status/date
22. Verify pagination
```

## 37. OpenAPI / client

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Regeneruj typed client, jeśli projekt go używa.

## 38. Documentation

Zaktualizuj `docs/architecture.md` o:

```text
Host operational read models
dashboard aggregation
unified Host calendar projection
read-side SQL
no separate dashboard source of truth
```

`docs/domain-language.md` aktualizuj tylko jeśli pojawi się naprawdę trwały domenowy koncept.

README: dodaj routes `/host`, `/host/calendar`, `/host/bookings`.

## 39. Quality gates

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

## 40. Definition of Done — Dashboard

Musi działać:

```text
Attention Required
Today
Arrivals
Departures
Pending Requests
Upcoming Stays
Property Overview
Calendar Sync Health
quick navigation/actions
```

## 41. Definition of Done — Unified Calendar

Musi działać:

```text
/host/calendar
all Host Properties
Property filter
BOOKING
active BOOKING_HOLD
HOST_BLOCK
EXTERNAL_CALENDAR
manual block/unblock reuse
responsive UX
```

## 42. Definition of Done — Booking Operations

Musi działać:

```text
reference search
Guest search
status filter
Property filter
date filter
pagination
existing actions
```

## 43. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
dashboard wykonuje kilkanaście niezależnych API calls
dashboard ma osobną source-of-truth tabelę
calendar robi N+1
quick actions omijają Booking state machine
expired Hold jest pokazany jako aktywny
external iCal ujawnia PII
Host widzi cudze dane
mobile calendar jest nieużywalny
```

## 44. Raport końcowy

Po zakończeniu podaj:

### Implemented
- Host operations dashboard;
- Attention projection;
- Today/arrivals/departures;
- Pending Requests;
- Upcoming Stays;
- Calendar health;
- Unified Host calendar;
- Booking filters/search;
- responsive UX;
- tests;
- docs.

### API
Wypisz nowe/zmienione endpointy.

### Database
Wypisz migrations/indexes, jeśli były.

### Verification

```text
attention: PASS/FAIL
today: PASS/FAIL
pending requests: PASS/FAIL
upcoming: PASS/FAIL
calendar health: PASS/FAIL

multi-property calendar: PASS/FAIL
BOOKING: PASS/FAIL
BOOKING_HOLD: PASS/FAIL
HOST_BLOCK: PASS/FAIL
EXTERNAL_CALENDAR: PASS/FAIL

cross-Host isolation: PASS/FAIL

lint: PASS/FAIL
typecheck: PASS/FAIL
unit tests: PASS/FAIL
integration/e2e: PASS/FAIL
build: PASS/FAIL
manual flow: PASS/FAIL
```

### Important decisions
Maksymalnie 5.

### Known limitations
Tylko realne.

### Next milestone

Nie implementuj.

Wskaż tylko:

> **Milestone 08: Payments & Booking Confirmation — Stripe sandbox, PaymentIntent, verified webhooks, atomic Booking confirmation, Refund recovery and Stripe Connect foundation.**

---

# 45. Final principle

Po Milestone 07 Host po wejściu do Rezervio powinien natychmiast wiedzieć:

> **Co dzieje się z moimi Property i co wymaga ode mnie działania?**

Dashboard i Calendar są read-modelami nad istniejącą domeną i PostgreSQL.

Nie implementuj jeszcze Payments.
