# Rezervio — Milestone 06: Guest Accounts & My Trips

> Cel: dodać opcjonalne konto Guest bez zwiększania tarcia przy rezerwacji, umożliwić Userowi dostęp do wszystkich swoich Booking w jednym miejscu oraz zachować jeden wspólny account dla roli Guest i Host.

---

## 0. Instrukcja nadrzędna

Pracujesz na istniejącym repozytorium Rezervio po ukończeniu Milestone 01–05.

Najpierw:
1. przeanalizuj aktualny model `User`, `Host`, auth, Booking i Guest access;
2. uruchom istniejące testy;
3. przeczytaj:
   - `docs/domain-language.md`
   - `docs/architecture.md`
   - `docs/milestone-01-backend-foundation.md`
   - `docs/milestone-02-host-property-management.md`
   - `docs/milestone-03-availability-calendar.md`
   - `docs/milestone-04-booking-core.md`
   - `docs/milestone-05-booking-operations-notifications.md`
4. dopiero potem rozpocznij implementację.

Nie implementuj Payments w tym milestone.

---

# 1. Główna decyzja domenowa

`User` jest wspólną tożsamością Rezervio.

```text
User
├── Guest — przez swoje Booking
└── Host — przez opcjonalny Host profile
```

Nie twórz osobnych:

```text
GuestAccount
HostAccount
```

Ta sama osoba może jednocześnie:
- rezerwować jako Guest;
- wystawiać Property jako Host.

---

# 2. Konto Guest jest opcjonalne

Booking nadal musi działać bez rejestracji:

```text
anonymous Guest
 ↓
Booking
 ↓
guest_user_id = NULL
guest_name/email/phone = snapshot
```

Nie dodawaj obowiązkowego register/login przed Booking.

---

# 3. Zakres

Zaimplementuj:

```text
general User account
Guest register/login UX
shared Guest + Host identity
User profile
bookings.guest_user_id
My Trips
Booking detail from account
secure anonymous Booking claim
claim after login/register
profile prefill in Booking form
account navigation
Host dashboard link for Host users
OpenAPI
migrations
tests
docs
```

Favorites mogą zostać dodane tylko jeśli główny scope jest skończony i nie opóźniają milestone.

---

# 4. Poza zakresem

Nie implementuj:

```text
Payments
Stripe
Refunds
Payouts
social login
Google/Apple login
MFA
complex account recovery
reviews
messaging
loyalty
saved payment methods
AI travel assistant
```

---

# 5. Zachowaj istniejący Host auth

Milestone 02 mógł stworzyć rejestrację:

```text
User + Host
```

Nie psuj istniejących Host accounts.

Docelowo:

```text
User
└── Host profile optional
```

Jeżeli istnieje `/host/register`, może nadal tworzyć `User + Host`.

General Guest registration tworzy:

```text
User only
```

---

# 6. Wspólny auth

Użyj istniejących:
- Argon2id;
- server-side sessions;
- HttpOnly cookie;
- rate limiting.

Nie przechodź na JWT/localStorage.

Preferowane frontend routes:

```text
/login
/register
```

Istniejące `/host/login` / `/host/register` mogą zostać zachowane lub kierować do wspólnego auth UI.

Nie utrzymuj dwóch niezależnych systemów logowania.

---

# 7. `GET /api/auth/me`

Powinien zwracać wspólną identity:

```json
{
  "user": {
    "id": "...",
    "email": "...",
    "firstName": "...",
    "lastName": "...",
    "phone": "..."
  },
  "host": {
    "id": "...",
    "displayName": "..."
  }
}
```

`host` może być `null`.

Frontend na tej podstawie wie:
- czy User jest zalogowany;
- czy posiada Host profile.

---

# 8. User profile

Rozszerz `users` o minimum:

```text
first_name nullable
last_name nullable
phone nullable
preferred_locale nullable
updated_at
```

Email pozostaje login identity.

Na tym milestone email w profilu preferuj jako read-only — nie implementuj zmiany emaila bez verification flow.

---

# 9. Account routes

Dodaj:

```text
/account
/account/trips
/account/profile
```

Jeżeli User ma Host profile:

```text
[ Panel gospodarza ]
```

Nie twórz osobnej aplikacji Guest.

---

# 10. Account dashboard

`/account`

Minimum:

```text
Cześć, {name}

Nadchodzące podróże
Oczekujące prośby
Ostatnie rezerwacje

[ Wszystkie podróże ]
[ Profil ]
[ Panel gospodarza ]  # tylko Host
```

---

# 11. My Trips

`/account/trips`

Kategorie:

```text
PENDING
UPCOMING
PAST
CANCELLED
```

Nie zapisuj ich jako Booking status.

Preferowane mapowanie:

```text
PENDING:
  PENDING_HOST_APPROVAL
  PENDING_PAYMENT

UPCOMING:
  CONFIRMED
  AND checkOut > today

PAST:
  CONFIRMED/COMPLETED
  AND checkOut <= today

CANCELLED:
  CANCELLED
  EXPIRED
```

Dostosuj do aktualnej state machine.

---

# 12. Trip card

Minimum:

```text
cover
Property
destination
checkIn/checkOut
Booking reference
status
total price
CTA: Zobacz szczegóły
```

---

# 13. Booking detail

Zalogowany User może odczytać Booking, jeśli:

```text
booking.guest_user_id == currentUser.id
```

Reuse istniejący Booking detail UI, jeśli możliwe.

Preferowana route:

```text
/account/trips/[reference]
```

lub reuse:

```text
/booking/[reference]
```

Nie duplikuj komponentów bez potrzeby.

---

# 14. `bookings.guest_user_id`

Dodaj:

```text
guest_user_id nullable
```

FK:

```text
users.id
```

Index:

```text
bookings.guest_user_id
```

Nie usuwaj:

```text
guest_name
guest_email
guest_phone
```

To pozostaje snapshot danych użytych przy konkretnym Booking.

---

# 15. Zalogowany Guest tworzy Booking

Przy `POST /api/bookings`:

jeżeli istnieje authenticated User:

```text
guest_user_id = currentUser.id
```

Booking nadal zapisuje Guest snapshot.

Zmiana User profile później NIE zmienia snapshotu istniejących Booking.

---

# 16. Booking form prefill

Jeżeli User jest zalogowany:
- prefill name;
- prefill email;
- prefill phone.

Guest może zmienić dane dla konkretnego Booking.

Zmiana pól Booking nie musi automatycznie modyfikować globalnego profilu.

---

# 17. Anonymous Booking claim — krytyczne

Istniejące Booking:

```text
guest_user_id = NULL
```

nie mogą być automatycznie przypisane do User tylko dlatego, że:

```text
booking.guest_email == user.email
```

Email sam nie jest wystarczającym authorization proof.

---

# 18. Secure claim flow

Preferowany:

```text
Guest otwiera secure Booking access link
 ↓
Guest loguje się / rejestruje
 ↓
backend ma:
  authenticated User
  valid Guest Booking access
 ↓
sprawdza zgodność email
 ↓
Booking.guest_user_id = User.id
```

Dodaj jawny command:

```text
claimBookingForCurrentUser
```

---

# 19. Claim endpoint

Np.:

```http
POST /api/bookings/:reference/claim
```

Wymaga jednocześnie:

```text
authenticated User
+
valid Guest Booking access
```

Preferuj także:

```text
normalized user.email == normalized booking.guest_email
```

Jeśli email różny — nie claimuj automatycznie.

---

# 20. Already claimed

Jeżeli:

```text
guest_user_id == currentUser.id
```

claim jest idempotentny.

Jeżeli:

```text
guest_user_id == anotherUser.id
```

zwróć:

```text
409 BOOKING_ALREADY_CLAIMED
```

Nie pozwalaj na przejęcie Booking.

---

# 21. Registration from Booking

Na secure Booking page dla anonymous Guest pokaż opcjonalnie:

```text
Zapisz tę podróż na koncie Rezervio
[ Utwórz konto ]
```

Po register:
- zachowaj Booking access context;
- claim;
- redirect do My Trips.

Nie wymuszaj rejestracji.

---

# 22. Existing User with same email

Jeśli account już istnieje:

```text
Masz już konto. Zaloguj się, aby dodać tę podróż.
```

Po login:
- zachowaj secure Booking access;
- wykonaj claim.

Nie twórz duplikatu User.

---

# 23. Host jako Guest

Existing Host może rezerwować cudze Property tym samym kontem:

```text
User
├── My Trips
└── Host Dashboard
```

Nie twórz osobnej sesji ani konta Guest.

---

# 24. Rezerwacja własnego Property

Na MVP zablokuj:

```text
authenticated Host
→ own Property
→ Booking
```

Backend:

```text
409 CANNOT_BOOK_OWN_PROPERTY
```

Nie tylko frontend.

---

# 25. Account navigation

Dla zalogowanego User publiczny header:

```text
Moje podróże
Profil
Panel gospodarza   # jeśli Host
Wyloguj
```

Zachowaj aktualny design Rezervio.

Nie przeładowuj headera.

---

# 26. Profile page

`/account/profile`

Minimum:

```text
firstName
lastName
email (read-only)
phone
preferredLocale
```

API:

```http
GET   /api/account/profile
PATCH /api/account/profile
```

PATCH może zmieniać:
- firstName;
- lastName;
- phone;
- preferredLocale.

---

# 27. My Trips API

Dodaj:

```http
GET /api/account/bookings
GET /api/account/bookings/:reference
```

Preferuj pagination:

```text
limit
cursor
```

Opcjonalnie:

```text
category=PENDING|UPCOMING|PAST|CANCELLED
```

Nie pobieraj całej historii bez limitu.

---

# 28. Source of truth My Trips

My Trips korzysta z:

```text
bookings.guest_user_id
```

Nie wyszukuje Booking po emailu na każdym request.

---

# 29. Guest access token po claim

Preferowane po udanym claim:

```text
revoke Guest access token
```

jeśli nie psuje ważnych istniejących linków.

Jeżeli zdecydujesz zachować token:
- account access jest primary;
- decyzję udokumentuj.

Nie twórz drugiej token table, jeśli Milestone 05 już ją posiada.

---

# 30. Auth return flow

Jeżeli login/register następuje w trakcie:
- Booking;
- claim;

nie gub:
- Property;
- Stay;
- guest count;
- Booking access context.

Po auth wróć do właściwego flow.

---

# 31. General register semantics

Docelowo:

```text
general register → User
host register/onboarding → User + optional Host profile
```

Jeśli aktualne API ma inną semantykę, zrefaktoruj kompatybilnie.

Nie usuwaj istniejących Host accounts.

---

# 32. Become Host foundation

Nie jest głównym celem, ale model ma pozwalać Userowi później dodać Host profile.

Jeżeli istniejący Host onboarding można łatwo reuse — użyj go.

Nie buduj nowego dużego onboarding flow.

---

# 33. Archived Property / history

My Trips musi działać nawet jeśli Property jest później:

```text
SUSPENDED
ARCHIVED
```

Nie opieraj historycznego Booking detail wyłącznie na publicznym Property endpoint.

Booking history musi pozostać dostępna.

---

# 34. Snapshot

Zachowaj minimum:

```text
property_title_snapshot
guest snapshot
price snapshot
```

Jeżeli My Trips bez tego jest nieczytelne po archiwizacji Property, możesz dodać minimalny:

```text
property_city_snapshot
cover_image_url_snapshot nullable
```

Nie twórz pełnego snapshot framework bez potrzeby.

---

# 35. Existing Booking migration

Nie backfilluj:

```text
guest_user_id
```

na podstawie emaila.

Existing Booking pozostają:

```text
guest_user_id = NULL
```

dopóki nie zostaną bezpiecznie claimed.

---

# 36. Existing Host migration

Existing Host User automatycznie może korzystać z `/account`.

Nie twórz nowego User.

My Trips może być puste.

---

# 37. Optional Favorites

Tylko jeśli główny milestone jest gotowy.

Model:

```text
favorite_properties
user_id
property_id
created_at
```

Unique:

```text
(user_id, property_id)
```

Ale Favorites NIE są Definition of Done.

---

# 38. Security

Obowiązkowo:

```text
User A cannot read User B Booking
User A cannot claim User B Booking
publicReference alone cannot authorize claim
email alone cannot authorize claim
foreign User cannot edit profile
already claimed Booking cannot be stolen
```

Dla foreign Booking preferuj `404`.

---

# 39. UI

Account area korzysta z obecnej palety i design language:

```text
Deep Pine
Coral
Cream
existing typography
existing spacing
```

My Trips ma wyglądać jak część travel marketplace, nie generic SaaS dashboard.

---

# 40. Loading / empty / errors

Obsłuż:

```text
loading
empty trips
API error
expired session
claim failed
already claimed
```

Empty:

```text
Nie masz jeszcze żadnych podróży.
[ Znajdź miejsce ]
```

---

# 41. Migrations

Drizzle migrations dla:

```text
users profile fields
bookings.guest_user_id
optional snapshot fields
optional favorites
indexes/FKs
```

Reuse istniejące Guest access tokens.

---

# 42. Tests — identity

Minimum:

```text
general Guest registration creates User only
Host registration remains compatible
existing Host can use /account
same User can act as Guest and Host
auth/me supports host=null
```

---

# 43. Tests — Booking association

Minimum:

```text
logged-in Booking sets guest_user_id
anonymous Booking leaves guest_user_id NULL
Guest snapshot always stored
profile edit does not mutate historical Booking snapshot
```

---

# 44. Tests — claim

Obowiązkowe:

```text
valid Guest access + logged User + matching email → claim
claim is idempotent
no Guest access → rejected
wrong email → rejected
publicReference only → rejected
already claimed by another User → rejected
```

---

# 45. Tests — My Trips

Minimum:

```text
User sees own Booking
cannot see another User Booking
PENDING classification
UPCOMING classification
PAST classification
CANCELLED/EXPIRED classification
pagination
archived Property Booking remains accessible
```

---

# 46. Tests — own Property

```text
Host booking own Property → rejected
Host booking another Host Property → allowed
```

---

# 47. Tests — profile

```text
GET own profile
PATCH allowed fields
email cannot be changed through generic PATCH
cannot modify another User
Booking snapshot remains unchanged
```

---

# 48. Manual end-to-end flow

Wykonaj:

```text
1. Register normal User, not Host
2. Verify /account
3. Search Property
4. Create Booking while logged in
5. Verify guest_user_id
6. Verify Booking in My Trips

7. Create anonymous Booking
8. Open secure Guest Booking link
9. Register matching User
10. Claim Booking
11. Verify it appears in My Trips

12. Try claim using wrong User/email
13. Verify rejected

14. Login as existing Host
15. Open /account
16. Verify Host dashboard link
17. Book Property belonging to another Host
18. Verify same User has My Trips + Host dashboard

19. Try to book own Property
20. Verify backend rejects
```

---

# 49. OpenAPI / typed client

Zaktualizuj:

```text
/api/docs
/api/openapi.json
```

Regeneruj typed client, jeśli istnieje.

Nie twórz równoległych ręcznych kontraktów.

---

# 50. Domain docs

Zaktualizuj `docs/domain-language.md`.

Musi jasno opisywać:

```text
User
Host profile
Guest as role/context, not separate account entity
Booking.guestUserId
Guest snapshot
Booking claim
```

Kluczowa zasada:

> User may act as both Guest and Host.

---

# 51. Architecture docs

Zaktualizuj `docs/architecture.md` o:

```text
shared User identity
optional Host profile
anonymous Booking
guest_user_id
secure claim
snapshot vs profile
account/Host navigation
```

---

# 52. README

Dodaj:

```text
Guest registration/login
/account
My Trips
secure claim flow
same account Guest + Host
```

---

# 53. Quality gates

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

---

# 54. Definition of Done — Identity

Musi działać:

```text
general User account
Host profile optional
same User Guest + Host
existing Host compatibility
Guest register/login/logout
```

---

# 55. Definition of Done — Booking ownership

Musi działać:

```text
guest_user_id nullable
logged-in association
anonymous Booking
secure claim
no email-only auto-link
snapshot preservation
```

---

# 56. Definition of Done — My Trips

Musi działać:

```text
/account
/account/trips
/account/profile
pending
upcoming
past
cancelled
Booking detail
pagination
loading/error/empty
```

---

# 57. Definition of Done — Security

Udowodnione testami:

```text
User A cannot access User B Booking
publicReference cannot claim Booking
wrong User cannot claim
already-owned Booking cannot be stolen
Host cannot book own Property
```

---

# 58. Nie kończ w połowie

Nie akceptuj implementacji, w której:

```text
Guest account jest wymagany do Booking
Guest i Host mają osobne auth systems
Booking jest automatycznie linkowany tylko po emailu
guest snapshot znika po dodaniu guest_user_id
existing Host traci dashboard/login
My Trips wyszukuje po email zamiast guest_user_id
publicReference jest security tokenem
```

---

# 59. Raport końcowy

Po zakończeniu podaj:

## Implemented

```text
shared User identity
Guest account
User profile
guest_user_id
secure claim
My Trips
account UI
Host/Guest navigation
tests
docs
```

## Database migrations
Wypisz pola, FK, indeksy i nowe tabele.

## API
Wypisz nowe/zmienione endpointy.

## Identity verification

```text
Guest registration: PASS/FAIL
existing Host compatibility: PASS/FAIL
same User Host+Guest: PASS/FAIL
```

## Booking ownership verification

```text
logged Booking association: PASS/FAIL
anonymous Booking: PASS/FAIL
secure claim: PASS/FAIL
wrong-user protection: PASS/FAIL
snapshot preservation: PASS/FAIL
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

> **Milestone 07: Host Operations Dashboard & Calendar UX — arrivals, departures, pending requests, upcoming stays, operational calendar and attention-needed workflows.**

---

# 60. Final principle

Po Milestone 06 Rezervio ma jeden spójny model tożsamości:

```text
User
├── My Trips
└── Host Profile (optional)
    └── Host Dashboard
```

Anonymous Booking nadal działa.

Konto daje wygodę i historię, ale nie jest barierą wejścia do Booking.

Nie implementuj jeszcze Payments.
