# Rezervio — Milestone 09: Stay Information & Guest–Host Messaging

> Cel: domknąć obsługę pobytu po potwierdzeniu Booking — Host konfiguruje informacje o pobycie raz, Rezervio automatycznie udostępnia je Guestowi w odpowiednim czasie, a Guest i Host mogą komunikować się w kontekście konkretnej rezerwacji.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–08.

Najpierw przeczytaj:

```text
CLAUDE.md
docs/domain-language.md
docs/architecture.md
docs/project-state.md        # jeśli istnieje
docs/milestone-09-stay-information-messaging.md
```

Następnie:
1. przeanalizuj aktualny kod;
2. przeanalizuj istniejące Booking, Property, Notifications, BullMQ, Guest access i Host auth;
3. uruchom istniejące testy;
4. dopiero potem rozpocznij implementację.

Nie czytaj wcześniejszych milestone 01–08, chyba że napotkasz konkretną niejasność wymagającą historycznego kontekstu.

---

## 1. Główny rezultat biznesowy

Po potwierdzeniu Booking:

```text
Booking = CONFIRMED
        ↓
Rezervio planuje automatyczne udostępnienie informacji o pobycie
        ↓
Guest otrzymuje wiadomość/email przed przyjazdem
        ↓
Guest widzi Stay Information w My Trips
        ↓
w razie potrzeby Guest ↔ Host komunikują się w kontekście Booking
        ↓
po zakończeniu pobytu Booking może przejść automatycznie do COMPLETED
```

Guest nie wykonuje żadnych dodatkowych akcji typu:
- „Przyjechałem”;
- manual check-in;
- manual check-out;
- potwierdzenie opuszczenia obiektu.

---

## 2. Zakres

Zaimplementuj:

```text
Property Stay Information
check-in/check-out time
arrival instructions
parking
Wi-Fi
house rules
departure instructions
emergency contact
sensitive access information
configurable reveal timing
automatic pre-arrival notification
checkout reminder
Guest Stay Details
Booking-scoped Conversation
Guest ↔ Host Messages
email notification for new message
polling/refetch
authorization
BullMQ jobs
OpenAPI
migrations
tests
docs
automatic CONFIRMED → COMPLETED
```

---

## 3. Poza zakresem

Nie implementuj:

```text
manual Guest check-in
manual Guest check-out
Host arrival/departure confirmation
WebSockets
typing indicators
online presence
voice/video
attachments
SMS
push notifications
AI message assistant
reviews
support chat
PMS messaging integration
smart-lock integration
automatic generation of door codes
```

---

# PART A — STAY INFORMATION

## 4. Stay Information belongs to Property

Host konfiguruje informacje raz dla Property.

Preferowany model:

```text
Property
└── StayInformation
```

Nie kopiuj całego zestawu instrukcji ręcznie do każdego Booking.

---

## 5. StayInformation model

Dodaj:

```text
property_stay_information
```

Minimum:

```text
id
property_id
check_in_time
check_out_time
arrival_instructions nullable
parking_instructions nullable
wifi_name nullable
wifi_password nullable
house_rules nullable
departure_instructions nullable
emergency_contact nullable
instructions_send_offset_hours
sensitive_access_reveal_offset_hours
created_at
updated_at
```

`property_id` unique.

---

## 6. Default timing

Default:

```text
instructions_send_offset_hours = 24
```

Host może wybrać np.:

```text
24h
48h
72h
```

UI:

```text
Wyślij szczegóły pobytu:
( ) 1 dzień przed
( ) 2 dni przed
( ) 3 dni przed
```

Backend zapisuje offset w godzinach.

---

## 7. Check-in / check-out time

Przechowuj jako local wall-clock time:

```text
15:00
11:00
```

Interpretacja odbywa się w:

```text
Property.timeZone
```

Nie zapisuj ich jako UTC instant.

---

## 8. Sensitive access information

Dodaj osobny model:

```text
property_sensitive_access
```

Minimum:

```text
id
property_id
access_instructions nullable
access_code nullable
keybox_location nullable
reveal_offset_hours
created_at
updated_at
```

Przykład:

```text
reveal_offset_hours = 6
```

czyli ujawnij 6h przed check-in.

---

## 9. Sensitive data rules

Przed reveal time backend NIE zwraca:
- access_code;
- pełnych sensitive instructions;
- keybox secret details.

Backend zwraca np.:

```json
{
  "available": false,
  "revealAt": "2026-09-12T09:00:00Z"
}
```

Po reveal:

```json
{
  "available": true,
  "accessCode": "123456",
  "accessInstructions": "...",
  "keyboxLocation": "..."
}
```

Frontend nie może być jedyną blokadą.

---

## 10. Encryption at rest

Sensitive access fields zaszyfruj w DB.

Reuse istniejący application encryption service/pattern z iCal URL, jeśli istnieje.

Preferuj AEAD, np. AES-256-GCM.

Env, jeśli potrzebny:

```env
STAY_SENSITIVE_DATA_ENCRYPTION_KEY=
```

Nie loguj plaintext secretów ani kluczy.

---

## 11. Host UI

W Property editor dodaj:

```text
Informacje dla gościa

Check-in
Check-out
Jak wejść
Parking
Wi-Fi
Zasady domu
Instrukcja wymeldowania
Kontakt awaryjny
```

oraz:

```text
Dane dostępu

Kod do drzwi / keybox
Instrukcja dostępu
Udostępnij:
  6h przed
  12h przed
  24h przed
```

---

## 12. Host API

Dodaj np.:

```http
GET /api/host/properties/:id/stay-information
PUT /api/host/properties/:id/stay-information

GET /api/host/properties/:id/sensitive-access
PUT /api/host/properties/:id/sensitive-access
```

Ownership obowiązkowe.

---

## 13. Current instructions vs Booking snapshot

Na MVP Guest może otrzymywać aktualne Property StayInformation.

Jeśli Host poprawi instrukcję przed pobytem, Guest powinien zobaczyć najnowszą wersję.

Nie snapshotuj całego StayInformation przy Booking create bez potrzeby.

---

## 14. Stay phase

Nie dodawaj Booking statusów:

```text
CHECKED_IN
CHECKED_OUT
```

Wyliczaj:

```text
BEFORE_STAY
IN_STAY
AFTER_STAY
```

na podstawie Booking dates i Property.timeZone.

---

## 15. Guest Stay Details

W `My Trips` / Booking detail dodaj:

```text
Twój pobyt
```

Minimum:

```text
Check-in
Check-out
Arrival instructions
Parking
Wi-Fi
House rules
Departure instructions
Emergency contact
Sensitive access status
Message Host
```

---

## 16. Before reveal UX

Jeśli sensitive access jeszcze ukryty:

```text
Kod dostępu będzie dostępny:
12 września o 09:00
```

Nie pokazuj części sekretu.

---

## 17. Automatic pre-arrival notification

Po:

```text
Booking → CONFIRMED
```

Rezervio planuje job:

```text
stay-instructions-ready
```

na:

```text
checkInDate + checkInTime - instructions_send_offset_hours
```

w `Property.timeZone`.

Przykład:

```text
check-in: 2026-09-12 15:00 Europe/Madrid
offset: 24h
send: 2026-09-11 15:00 Europe/Madrid
```

---

## 18. Notification content

Email:
- Booking reference;
- Property;
- Stay dates;
- krótki komunikat;
- CTA do `My Trips → Stay Details`.

Nie wysyłaj pełnego access code w emailu.

---

## 19. Sensitive reveal notification

Jeśli access code ma osobny reveal time, enqueue:

```text
sensitive-access-ready
```

Guest dostaje:

```text
Dane dostępu do obiektu są już dostępne w Rezervio.
```

Bez secret code w emailu.

---

## 20. Checkout reminder

Dodaj:

```text
stay-checkout-reminder
```

Domyślnie:

```text
24h przed checkOut
```

Email zawiera:
- check-out time;
- CTA do departure instructions.

Nie wymaga Guest confirmation.

---


## 20A. Manual sensitive access trigger by Host

Host musi mieć możliwość ręcznego udostępnienia sensitive access dla konkretnego Booking.

Cel:
- łatwe testowanie lokalne;
- sytuacje operacyjne, gdy Host chce wyjątkowo udostępnić dane wcześniej.

Dodaj Host command, np.:

```http
POST /api/host/bookings/:id/sensitive-access/reveal
```

lub równoważny zgodny z aktualnym API.

Operacja:
- wymaga authenticated Host;
- wymaga ownership Booking;
- Booking musi być co najmniej `CONFIRMED`;
- działa wyłącznie dla konkretnego Booking;
- NIE zmienia domyślnego `reveal_offset_hours` na Property;
- jest idempotentna;
- zapisuje audit/BookingEvent;
- po sukcesie enqueue `sensitive-access-ready` notification do Guest.

Preferowany model to per-Booking override, np.:

```text
booking_sensitive_access_overrides
```

lub minimalne pole/event, jeśli aktualny model pozwala zrobić to czyściej.

Semantyka:

```text
effectiveRevealAt =
  manualRevealAt ?? calculatedRevealAt
```

Manual trigger ustawia:

```text
manualRevealAt = now()
```

Od tego momentu backend może zwracać sensitive access Guestowi.

UI Host:

```text
Dane dostępu
Domyślnie dostępne: 12 września, 09:00

[ Udostępnij teraz ]
```

Przed wykonaniem pokaż confirmation:

```text
Gość otrzyma dostęp do danych wejścia natychmiast.
```

Nie wysyłaj samego kodu w emailu. Email tylko informuje:

```text
Dane dostępu do obiektu są już dostępne w Rezervio.
```

Manual trigger powinien działać również w development/sandbox bez czekania na zegar, aby umożliwić pełny manual E2E test.

Testy minimum:

```text
Host can reveal own Booking
foreign Host rejected
unconfirmed Booking rejected
second trigger is idempotent
manual reveal does not change Property default offset
Guest sees secret immediately after trigger
exactly one notification is sent
audit event exists
```

---

## 21. BullMQ jobs

Reuse Redis + BullMQ.

Minimum:

```text
stay-instructions-ready
sensitive-access-ready
stay-checkout-reminder
booking-complete
```

Każdy job:
- idempotentny;
- stable jobId;
- retry-safe.

---

## 22. Rescheduling

Jeżeli przed pobytem zmieni się:
- check-in date;
- check-in time;
- check-out;
- notification offset;

scheduled jobs muszą zostać przeliczone/zastąpione.

Nie zostawiaj starych jobów.

Jeśli Booking dates są immutable, udokumentuj to i obsłuż tylko realnie możliwe zmiany.

---

## 23. Booking completed

Bez manualnego checkout.

Po checkOut w Property.timeZone job:

```text
booking-complete
```

wykonuje:

```text
CONFIRMED → COMPLETED
```

Idempotentnie.

---

# PART B — GUEST ↔ HOST MESSAGING

## 24. Conversation scope

Conversation istnieje wyłącznie w kontekście Booking:

```text
Booking
└── Conversation
    └── Messages
```

Nie twórz globalnego User-to-User messenger.

---

## 25. Conversation model

Dodaj:

```text
booking_conversations
```

Minimum:

```text
id
booking_id
created_at
updated_at
```

`booking_id` unique.

---

## 26. Message model

Dodaj:

```text
booking_messages
```

Minimum:

```text
id
conversation_id
sender_user_id nullable
sender_type
body
created_at
```

Sender:

```text
GUEST
HOST
SYSTEM
```

Bez attachments.

---

## 27. Anonymous Guest

Anonymous Guest może pisać tylko z valid Guest Booking access.

Wtedy:

```text
sender_user_id = NULL
sender_type = GUEST
```

---

## 28. Logged Guest

Jeśli Booking posiada `guest_user_id`, authenticated User musi odpowiadać temu User.

---

## 29. Host authorization

Host może czytać/pisać tylko dla Booking swoich Property.

Backend ownership obowiązkowe.

---

## 30. Messaging lifecycle

Read history pozostaje dostępne dla authorized participants.

Write dopuść dla aktywnych/recent Booking według prostej jawnej reguły.

Nie komplikuj lifecycle bez potrzeby.

---

## 31. Guest messaging API

Dodaj:

```http
GET  /api/bookings/:reference/messages
POST /api/bookings/:reference/messages
```

Wymaga:
- logged Guest ownership;
- albo valid Guest Booking access.

---

## 32. Host messaging API

Dodaj:

```http
GET  /api/host/bookings/:id/messages
POST /api/host/bookings/:id/messages
```

Host ownership obowiązkowe.

---

## 33. Message rules

Minimum:

```text
1–4000 chars
plain text
trim
```

Nie renderuj raw HTML.

Nie implementuj Markdown bez potrzeby.

---

## 34. Pagination

GET messages:
- cursor pagination;
- consistent ordering;
- recent messages first/load older on demand.

Nie pobieraj całej historii bez limitu.

---

## 35. Realtime strategy

Nie implementuj WebSockets.

MVP:

```text
refetch on focus
+
polling while conversation open
```

Np. co 5–10 sekund.

---

## 36. Message notifications

Po zapisie Message:

```text
DB commit
 ↓
BullMQ
 ↓
email notification
```

Guest → email do Host.  
Host → email do Guest.

Email failure nie może rollbackować Message.

---

## 37. Notification dedup

Dedup key:

```text
booking-message:{messageId}:{recipient}
```

Retry nie może wysyłać duplikatów.

---

## 38. Guest Conversation UI

W Booking detail:

```text
[ Napisz do gospodarza ]
```

Conversation:
- Property + Stay context;
- message history;
- text input;
- Send.

---

## 39. Host Conversation UI

W Host Booking detail:

```text
Wiadomości z gościem
```

Pokaż:
- Guest;
- Property;
- Stay;
- conversation.

Nie buduj jeszcze globalnego `/host/messages`.

---

# PART C — SECURITY / PRIVACY

## 40. Sensitive data security

Nie loguj:
- access code;
- Wi-Fi password;
- keybox secret;
- encryption key.

Nie wysyłaj access code w zwykłym emailu.

---

## 41. StayInfo access

Guest może odczytać pełne StayInformation tylko dla Booking, do którego ma poprawny dostęp.

Nie twórz publicznego pełnego:

```text
/property/:id/stay-information
```

---

## 42. Public Property page

Publicznie można pokazać tylko np.:
- check-in from;
- check-out until;
- selected house rules.

Nigdy:
- Wi-Fi password;
- door code;
- keybox secret;
- private emergency details.

---

## 43. Message privacy

Message dostępna wyłącznie:
- Hostowi danego Booking;
- Guestowi danego Booking.

---

# PART D — DATABASE / API / DOCS

## 44. Migrations

Drizzle migrations dla:

```text
property_stay_information
property_sensitive_access
booking_conversations
booking_messages
required indexes
```

---

## 45. Indexes

Minimum:

```text
property_stay_information.property_id UNIQUE
property_sensitive_access.property_id UNIQUE
booking_conversations.booking_id UNIQUE
booking_messages.conversation_id
booking_messages.created_at
```

---

## 46. OpenAPI

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Dodaj:
- Host StayInformation;
- Guest StayDetails;
- sensitive access response;
- Guest messaging;
- Host messaging.

Regeneruj typed client, jeśli istnieje.

---

## 47. Domain docs

Zaktualizuj `docs/domain-language.md` o trwałe koncepty:

```text
StayInformation
SensitiveAccess
Conversation
Message
StayPhase
```

---

## 48. Architecture docs

Zaktualizuj `docs/architecture.md` o:

```text
Property-level StayInformation
sensitive data encryption/reveal
timezone-based scheduling
BullMQ stay lifecycle jobs
Booking-scoped messaging
email notification side effects
polling instead of WebSockets
```

---

## 49. Project state

Jeśli istnieje:

```text
docs/project-state.md
```

zaktualizuj go po milestone.

Kolejne milestone mają korzystać z tego pliku zamiast czytać całą historię.

---

# PART E — TESTS

## 50. StayInformation tests

Minimum:

```text
Host create/update own StayInformation
foreign Host rejected
times/offset saved
authorized Guest can read
unrelated Guest rejected
public endpoint does not leak sensitive data
```

---

## 51. Sensitive access tests

Minimum:

```text
stored encrypted
before reveal → secret absent
after reveal → secret returned
revealAt uses Property.timeZone
foreign Guest rejected
secret absent from logs
```

---

## 52. Scheduling tests

Minimum:

```text
CONFIRMED schedules instructions
correct offset
correct timezone
sensitive reveal independently scheduled
checkout reminder scheduled
duplicate confirmation doesn't duplicate jobs
```

---

## 53. Messaging tests

Minimum:

```text
Guest can send
Host can send
Guest reads own conversation
Host reads own conversation
foreign Guest rejected
foreign Host rejected
message length validated
HTML safe
pagination works
anonymous Guest access works
```

---

## 54. Notification tests

Minimum:

```text
Guest message → one Host email
Host message → one Guest email
retry doesn't duplicate logical notification
email failure doesn't rollback Message
```

---

## 55. Completion tests

Minimum:

```text
CONFIRMED after checkout → COMPLETED
before checkout stays CONFIRMED
retry idempotent
timezone boundary correct
```

---

# PART F — MANUAL FLOW

## 56. Manual end-to-end

Wykonaj:

```text
1. Login as Host
2. Configure Property:
   check-in 15:00
   check-out 11:00
   arrival instructions
   parking
   Wi-Fi
   house rules
   departure instructions
3. pre-arrival send = 24h
4. sensitive reveal = 6h
5. Save

6. Prepare CONFIRMED Booking
7. Guest opens My Trips
8. Verify StayInformation visible
9. Verify sensitive code hidden
10. As Host click `Udostępnij teraz`
11. Verify Guest immediately sees sensitive access
12. Verify exactly one `sensitive-access-ready` email
13. Verify Property default reveal offset did not change

14. Create another CONFIRMED Booking
15. Force/advance natural reveal time
16. Verify secret becomes visible automatically

17. Trigger pre-arrival notification
13. Verify email in Mailpit
14. Verify CTA to Stay Details

15. Guest sends Message
16. Verify persistence + Host email
17. Host replies
18. Verify Guest sees reply + email

19. Trigger checkout reminder
20. Verify departure instructions

21. Advance past checkOut
22. Run completion job
23. Verify Booking → COMPLETED
```

---

# PART G — UX PRINCIPLE

## 57. Guest Stay Details

Preferowany układ:

```text
Twój pobyt
12–18 września

Check-in
od 15:00
[ instrukcja ]

Dostęp do obiektu
[ dostępny / dostępny od ... ]

Wi-Fi
...

Parking
...

Zasady domu
...

Check-out
do 11:00
[ instrukcja ]

[ Napisz do gospodarza ]
```

---

## 58. Minimal interaction

Guest NIE powinien wykonywać:

```text
check-in
check-out
I arrived
I left
confirm stay
```

System wylicza stan z Booking i czasu.

---

## 59. Host automation

Host konfiguruje informacje raz per Property.

Nie musi pamiętać o ręcznym wysyłaniu instrukcji dla każdego Booking.

Automatyzacja jest domyślna.

---

# PART H — QUALITY

## 60. Quality gates

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

## 61. Definition of Done

### Stay Information

```text
Host config per Property
check-in/check-out
arrival instructions
parking
Wi-Fi
house rules
departure instructions
emergency contact
configurable timing
Guest Stay Details
```

### Sensitive Access

```text
encrypted at rest
configurable reveal offset
backend-enforced reveal
no secret before revealAt
authorized Guest only
Host manual per-Booking reveal
manual reveal does not modify Property defaults
manual trigger is idempotent and audited
```

### Messaging

```text
one Conversation per Booking
Guest → Host
Host → Guest
anonymous Guest support
authorization
pagination
polling/refetch
email notification
dedup
```

### Lifecycle

```text
pre-arrival notification
sensitive access reveal
checkout reminder
automatic CONFIRMED → COMPLETED
```

Bez manual check-in/out.

---

## 62. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
Guest musi kliknąć check-in/check-out
Host musi ręcznie wysyłać instrukcje
door code widoczny zaraz po Booking bez scheduled/manual reveal
manual reveal zmienia globalny Property offset
frontend sam ukrywa secret bez backend enforcement
access code jest w plaintext logs
Conversation nie jest związana z Booking
dowolny User może pisać do dowolnego Host
email failure rollbackuje Message
WebSockets są dodane bez potrzeby
```

---

## 63. Raport końcowy

Po zakończeniu podaj:

### Implemented

```text
StayInformation
SensitiveAccess
automatic scheduling
Guest Stay Details
Booking Conversation
Messages
notifications
Booking completion
tests
docs
```

### Database
Wypisz tabele, pola, indeksy i encryption-related storage.

### API
Wypisz nowe endpointy.

### Stay verification

```text
Host configuration: PASS/FAIL
pre-arrival timing: PASS/FAIL
sensitive reveal: PASS/FAIL
checkout reminder: PASS/FAIL
Booking completion: PASS/FAIL
```

### Messaging verification

```text
Guest → Host: PASS/FAIL
Host → Guest: PASS/FAIL
anonymous Guest: PASS/FAIL
cross-user isolation: PASS/FAIL
pagination: PASS/FAIL
email notification: PASS/FAIL
dedup: PASS/FAIL
```

### Quality

```text
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

> **Milestone 10: Host Settlement & Payouts — PlatformFee accounting, Host balance, transfer/payout strategy, refund interaction and reconciliation.**

---

## 64. Final principle

Po Milestone 09 Guest po prostu otrzymuje właściwe informacje we właściwym czasie.

```text
Booking CONFIRMED
        ↓
Rezervio automatycznie udostępnia informacje
        ↓
Guest ma Stay Details
        ↓
Guest ↔ Host mogą się komunikować
        ↓
Booking automatycznie → COMPLETED
```

Im mniej niepotrzebnych interakcji, tym lepiej.
