# Rezervio — język domenowy i zasady techniczne

> Status: dokument roboczy dla MVP  
> Zakres: marketplace krótkoterminowego wynajmu apartamentów i domów wakacyjnych  
> Cel: utrzymać jeden spójny język w produkcie, kodzie, bazie danych, API, logach i dokumentacji.

---

## 1. Główna zasada domenowa

Rezervio łączy:

- **Host** — gospodarza/operatora oferującego obiekt,
- **Guest** — gościa szukającego i rezerwującego pobyt,
- **Property** — pojedynczy obiekt możliwy do niezależnej rezerwacji,
- **Booking** — rezerwację Property na określony termin.

Dla MVP obowiązuje:

> **1 Property = 1 niezależnie rezerwowalna jednostka.**

Przykłady:

- apartament = 1 Property,
- dom wakacyjny = 1 Property,
- willa = 1 Property,
- studio = 1 Property.

Na MVP **nie obsługujemy** jeszcze hotelowego inventory typu:
- room type,
- 20 identycznych pokoi,
- allotment,
- multi-room booking.

To będzie osobny model w późniejszym etapie.

---

# 2. Ubiquitous Language — słownik domenowy

Poniższe nazwy są nazwami kanonicznymi. Używamy ich konsekwentnie w:

- backendzie,
- frontendzie,
- bazie danych,
- REST API,
- eventach,
- logach,
- testach,
- dokumentacji.

---

## User

Osoba posiadająca konto w Rezervio. **Jedna wspólna tożsamość.**

```text
User
├── Guest — przez swoje Booking
└── Host  — przez opcjonalny profil Host
```

Ta sama osoba może jednocześnie rezerwować cudze obiekty i wystawiać własne.
Nie tworzymy osobnych tożsamości logowania ani osobnych encji:

```text
GuestAccount    ← nie istnieje
HostAccount     ← nie istnieje
```

**Guest to rola i kontekst, nie encja.** Nie ma tabeli `guests`: bycie Guestem
oznacza po prostu posiadanie Booking.

**Host to opcjonalny profil**, a nie konto. `hosts.user_id` wskazuje na User;
konto bez profilu Host jest w pełni poprawne, a `auth/me` zwraca wtedy
`host: null`.

Konto **nigdy nie jest wymagane do rezerwacji** — patrz `GuestBookingAccess`.

**Nazwa kanoniczna:**

```text
User
```

Nie używamy zamiennie:

```text
Customer
Client
Person
AccountOwner
```

---

## UserSession

Serwerowa sesja logowania User.

Rezervio używa **opaque server-side sessions**, nie JWT: token jest losowym
ciągiem bez znaczenia semantycznego, a źródłem prawdy o ważności sesji jest
baza danych.

**Nazwa kanoniczna:**

```text
UserSession
```

Nie używamy zamiennie:

```text
Token
Ticket
Credential
LoginSession
```

Zasady:

```text
token   >= 32 bajty entropii
w bazie zapisujemy wyłącznie hash tokena
transport: HttpOnly cookie
nigdy localStorage/sessionStorage
```

Wygaśnięta UserSession nie daje żadnych uprawnień, niezależnie od tego, czy
rekord został już fizycznie usunięty.

Sesji nie logujemy — ani tokena, ani jego hasha.

---

## Guest

Rola: osoba, która wyszukuje Property i dokonuje Booking.

Guest **nie musi mieć konta**. Rezerwacja anonimowa jest pełnoprawna:

```text
guest_user_id                  = NULL
guest_name/email/phone         = snapshot
```

Kiedy Booking składa zalogowany User, zapisujemy dodatkowo `guest_user_id` —
ale snapshot i tak powstaje.

**Nazwa kanoniczna:**

```text
Guest
```

Nie używamy w kodzie zamiennie:

```text
Customer
Traveller
Traveler
Tenant
Renter
```

`Traveller` może występować w marketingu, ale nie jako encja domenowa.

---

## Host

Osoba lub firma odpowiedzialna za wystawienie i obsługę jednego lub wielu Property.

Host może być:

- właścicielem,
- property managerem,
- agencją,
- firmą zarządzającą najmem.

**Nazwa kanoniczna:**

```text
Host
```

Nie używamy zamiennie:

```text
Owner
Landlord
Advertiser
Seller
Provider
```

Host nie musi być prawnym właścicielem nieruchomości.

---

## Property

Jedna niezależnie rezerwowalna jednostka noclegowa.

Przykładowe `propertyType`:

```text
APARTMENT
HOUSE
VILLA
STUDIO
```

**Nazwa kanoniczna:**

```text
Property
```

Nie używamy zamiennie:

```text
Offer
Accommodation
Apartment
Unit
Place
Hotel
```

---

## Listing

Publiczna prezentacja Property w marketplace.

Listing obejmuje m.in.:

- tytuł,
- opis,
- zdjęcia,
- amenities,
- sposób prezentacji lokalizacji,
- informacje cenowe,
- status publikacji.

Rozróżnienie pojęciowe:

```text
Property = co można zarezerwować
Listing  = jak Property jest prezentowane użytkownikowi
```

Na MVP dane Listing mogą fizycznie znajdować się w agregacie Property.

Nie tworzymy osobnej tabeli `listing`, dopóki nie pojawi się realna potrzeba.

---

## Stay

Pobyt Guest w Property.

Składa się z:

```text
checkIn
checkOut
guests
nights
```

Bardzo ważna zasada:

```text
checkIn  = inclusive
checkOut = exclusive
```

Przykład:

```text
checkIn  = 2026-09-12
checkOut = 2026-09-16
nights   = 4
```

Nie nazywamy tego w domenie:

```text
RentalPeriod
Trip
Vacation
ReservationPeriod
```

---

## Availability

Informacja, czy Property może zostać zarezerwowane w danym terminie.

Na Availability wpływają:

- Confirmed Booking,
- aktywny Booking Hold,
- Host Block,
- External Calendar Block,
- Maintenance,
- reguły minimum/maximum stay.

**Nazwa kanoniczna:**

```text
Availability
```

Availability jest zależne od daty.

Nie traktujemy go jako zwykłego `boolean` na Property.

---

## AvailabilityBlock

Blokada terminu, w którym Property nie może być zarezerwowane.

Typy:

```text
BOOKING
BOOKING_HOLD
HOST_BLOCK
EXTERNAL_CALENDAR
EXTERNAL_PROVIDER
MAINTENANCE
```

**Nazwa kanoniczna:**

```text
AvailabilityBlock
```

`EXTERNAL_CALENDAR` i `EXTERNAL_PROVIDER` to celowo dwie różne rzeczy. Pierwsza
to nieprzejrzysty okres zajętości ze snapshotu iCal. Druga to rezerwacja, którą
znamy po identyfikatorze i możemy prześledzić przez modyfikację i anulowanie.

---

## DailyRate

Cena za jedną noc Property dla konkretnej daty.

**Nazwa kanoniczna:**

```text
DailyRate
```

Przykład:

```text
propertyId
date
amount
currency
```

Nie używamy zamiennie jako encji:

```text
NightPrice
Tariff
RoomPrice
```

---

## PriceQuote

Wyliczona cena dla konkretnego:

```text
Property + Stay
```

w konkretnym momencie.

Może zawierać:

```text
accommodationAmount
cleaningFee
serviceFee
taxAmount
discountAmount
totalAmount
currency
expiresAt
```

PriceQuote nie jest Booking.

Może wygasnąć.

---

## Total Price

Pełna cena widoczna dla Guest dla wybranego Stay.

Zasada produktowa Rezervio:

> **Total price first.**

W UI priorytetem jest:

```text
1 920 zł · 4 noce · cena całkowita
```

a nie:

```text
480 zł / noc
```

Obowiązkowe opłaty powinny być uwzględnione w `totalAmount` przed potwierdzeniem Booking.

---

## MarketPrice

Referencyjna/estymowana cena używana do oceny atrakcyjności oferty.

**Nazwa kanoniczna:**

```text
MarketPrice
```

To nie jest automatycznie cena konkurencji.

Nie pokazujemy:

```text
Booking.com: 2200 zł
```

jeżeli nie mamy wiarygodnego i legalnego źródła takich danych.

---

## Saving

Różnica między wiarygodnym MarketPrice a TotalPrice.

Przykład:

```text
marketPrice = 2200 PLN
totalPrice  = 1920 PLN
saving      = 280 PLN
```

Jeśli cena referencyjna jest niewiarygodna — nie pokazujemy Saving.

---

## Booking

Rezerwacja Property przez Guest.

**Nazwa kanoniczna:**

```text
Booking
```

Nie używamy w kodzie zamiennie:

```text
Reservation
Order
Purchase
Rental
Transaction
```

W polskim UI oczywiście używamy słowa „rezerwacja”.

---

## BookingHold

Tymczasowa blokada inventory na czas finalizacji rezerwacji/płatności.

**Nazwa kanoniczna:**

```text
BookingHold
```

TTL (`BOOKING_HOLD_TTL_SECONDS`):

```text
10 minut
```

Statusy:

```text
ACTIVE
RELEASED
EXPIRED
CONVERTED
```

Jeden Hold na Booking — wymuszone unikalnym indeksem, żeby ponowiona komenda
nie mogła utworzyć drugiego.

BookingHold blokuje termin **tylko** gdy:

```text
status = ACTIVE  AND  expiresAt > now()
```

Wygasły Hold nie wpływa na Availability **natychmiast**, niezależnie od tego,
czy job sprzątający zdążył się wykonać. Dostępność nigdy nie zależy od tego, że
worker zadziałał na czas.

---

## BookingRequest

Prośba o rezerwację wymagająca akceptacji Host.

Używamy tylko dla modelu:

```text
request-to-book
```

Rozróżnienie:

```text
BookingHold    = techniczna blokada terminu
BookingRequest = biznesowy workflow akceptacji
```

Nie mieszamy tych pojęć.

---

## Payment

Płatność Guest.

**Nazwa kanoniczna:**

```text
Payment
```

Rezervio nie przechowuje surowych danych kart.

Źródłem prawdy o powodzeniu Payment jest PSP/webhook, nie frontend.

**Statusy kanoniczne:**

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

Nie mapujemy 1:1 statusów PSP do domeny — dostawca rozróżnia więcej stanów, niż
potrzebuje Rezervio.

`REQUIRES_ACTION` **nie jest** porażką: to trwające wyzwanie 3-D Secure.
Potraktowanie go jako final failure odrzucałoby w Europie większość płatności.

Kwota Payment pochodzi wyłącznie ze snapshotu Booking:

```text
Booking.totalAmountMinor
Booking.currency
```

Kwota przysłana przez przeglądarkę jest ignorowana.

---

## Payout

Wypłata środków należnych Host.

**Nazwa kanoniczna:**

```text
Payout
```

Nie używamy `Payment` dla wypłaty do Host.

Cztery różne rzeczy, których nigdy nie mylimy:

```text
Payment     Guest              → Rezervio
Settlement  ile należy się Hostowi i od kiedy
Transfer    saldo platformy    → Connected Account Hosta
Payout      Connected Account  → bank Hosta
```

```text
Payment    != Settlement
Settlement != Transfer
Transfer   != Payout
```

Udany Payment **nie** oznacza, że Host dostał pieniądze.

Payout wykonuje dostawca według harmonogramu konta — Rezervio go obserwuje,
a nie inicjuje. Statusy:

```text
PENDING
IN_TRANSIT
PAID
FAILED
CANCELLED
```

---

## Settlement

Wewnętrzne rozliczenie Rezervio: ile należy się Hostowi za konkretną rezerwację
i od kiedy.

**Nazwa kanoniczna:**

```text
Settlement
```

```text
gross        = Booking total snapshot
- platformFee = PlatformFee snapshot
= hostAmount
```

**Settlement nie jest przelewem.** To zapis zobowiązania, nie ruch pieniędzy.

Statusy:

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

Jeden Settlement na Booking — wymusza to unikalny indeks, nie ostrożność w kodzie.

---

## HostAmount

Kwota należna Hostowi za daną rezerwację.

**Nazwa kanoniczna:**

```text
HostAmount
```

Pochodzi **wyłącznie** z niezmiennego snapshotu finansowego Booking. Nigdy
z request body i nigdy przez przeliczenie starej rezerwacji aktualną prowizją.

---

## releaseAt

Moment, od którego środki mogą zostać przekazane Hostowi.

**Nazwa kanoniczna:**

```text
releaseAt
```

```text
releaseAt = check-in (w Property.timeZone) + HOST_SETTLEMENT_RELEASE_DELAY_HOURS
```

Zapisywany jako instant. Kolejka nie jest źródłem prawdy — decyduje kolumna
`release_at` i status Settlement.

---

## Transfer

Ruch pieniędzy z salda platformy na Connected Account Hosta.

**Nazwa kanoniczna:**

```text
Transfer
```

To główna operacja finansowa kontrolowana przez Rezervio.

**Transfer != Payout.**

---

## TransferReversal

Cofnięcie wykonanego Transfer po zwrocie dla gościa.

**Nazwa kanoniczna:**

```text
TransferReversal
```

W modelu Separate Charges and Transfers zwrot obciążenia **nie** cofa
wcześniejszego Transfer — pieniądze są już u Hosta. Trzeba je odzyskać osobno,
dokładnie raz.

---

## PlatformFee

Prowizja zatrzymywana przez Rezervio.

**Nazwa kanoniczna:**

```text
PlatformFee
```

Przykład:

```text
grossAmount = 2000 PLN
platformFee = 100 PLN
paymentFee  = 25 PLN
hostAmount  = 1875 PLN
```

Historycznych kwot nie wyliczamy ponownie na podstawie aktualnego procentu prowizji.

Zapisujemy wartości użyte w konkretnej transakcji.

---

## Refund

Zwrot pieniędzy Guest.

**Nazwa kanoniczna:**

```text
Refund
```

Typ:

```text
FULL
PARTIAL
```

Statusy:

```text
PENDING
PROCESSING
SUCCEEDED
FAILED
```

Cancellation Booking i Refund są powiązane, ale nie są tym samym procesem.

Decyzją o zwrocie jest **wiersz Refund w PostgreSQL**, a nie zadanie w kolejce.
Kolejka jedynie wykonuje decyzję u dostawcy; skasowanie Redisa nie może
sprawić, że Guest przestanie być uprawniony do pieniędzy.

Zwrot jest dokładnie jeden na parę `(Payment, reason)` — wymusza to unikalny
indeks, nie ostrożność w kodzie.

---

## StayInformation

Komplet informacji, których Guest potrzebuje, żeby skorzystać z obiektu.

**Nazwa kanoniczna:**

```text
StayInformation
```

Należy do **Property**, nie do Booking. Host konfiguruje ją raz; poprawka
instrukcji wejścia ma dotrzeć do gościa, który przyjeżdża jutro.

Zawiera m.in.:

```text
checkInTime / checkOutTime
arrivalInstructions
parkingInstructions
wifiName / wifiPassword
houseRules
departureInstructions
emergencyContact
```

Godziny są **lokalnym czasem zegarowym** obiektu (`15:00`), interpretowanym
w `Property.timeZone`. Nie zapisujemy ich jako instantu UTC.

Publicznie pokazujemy wyłącznie `checkInTime`, `checkOutTime` i `houseRules`.
Reszta wymaga dostępu do konkretnego Booking.

---

## SensitiveAccess

Dane, którymi otwiera się drzwi.

**Nazwa kanoniczna:**

```text
SensitiveAccess
```

Osobny model od `StayInformation`, bo rządzi się innymi regułami:

- szyfrowane at rest (AES-256-GCM);
- ujawniane dopiero w `revealAt`, o czym decyduje **backend**;
- nigdy nie trafiają do emaila.

```text
effectiveRevealAt = manualRevealAt ?? checkInAt - revealOffsetHours
```

`manualRevealAt` jest per Booking. Ręczne udostępnienie jednemu gościowi
**nie zmienia** domyślnego offsetu Property.

---

## StayPhase

Gdzie znajduje się pobyt w czasie.

**Nazwa kanoniczna:**

```text
StayPhase
```

Wartości:

```text
BEFORE_STAY
IN_STAY
AFTER_STAY
```

**Wyliczane**, nie przechowywane — z dat Booking i `Property.timeZone`.

Nie dodajemy statusów `CHECKED_IN` ani `CHECKED_OUT`. Guest niczego nie
potwierdza: nie klika „przyjechałem" ani „wyjechałem".

---

## Conversation

Rozmowa Guest ↔ Host w kontekście jednej rezerwacji.

**Nazwa kanoniczna:**

```text
Conversation
```

Istnieje **wyłącznie** wewnątrz Booking — jedna na Booking. Nie budujemy
globalnego messengera User↔User: bez Booking nie ma o czym rozmawiać i nikt
nie jest uprawniony.

---

## Message

Pojedyncza wiadomość w Conversation.

**Nazwa kanoniczna:**

```text
Message
```

Nadawca:

```text
GUEST
HOST
SYSTEM
```

`senderUserId` jest nullable — Guest bez konta też pisze, przez ważny Guest
Booking access. Treść to zwykły tekst (1–4000 znaków); nie renderujemy HTML
ani Markdown.

---

## CancellationPolicy

Reguły anulowania Booking.

**Nazwa kanoniczna:**

```text
CancellationPolicy
```

Na MVP preferujemy mały zbiór:

```text
FLEXIBLE
MODERATE
STRICT
CUSTOM
```

---

## Amenity

Ustrukturyzowane udogodnienie Property.

Przykładowe stabilne kody:

```text
WIFI
PARKING
POOL
AIR_CONDITIONING
WASHING_MACHINE
KITCHEN
BALCONY
ELEVATOR
SEA_VIEW
```

**Nazwa kanoniczna:**

```text
Amenity
```

W bazie zapisujemy kod:

```text
PARKING
```

a nie tłumaczenie:

```text
Parking
Parkplatz
Aparcamiento
```

Tłumaczenia są warstwą prezentacji/i18n.

---

## ExternalCalendar

Kalendarz zarządzany poza Rezervio.

**Nazwa kanoniczna:**

```text
ExternalCalendar
```

Provider może być np.:

```text
BOOKING
AIRBNB
VRBO
PMS
OTHER
```

Provider jest metadanym integracji, a nie częścią modelu Availability.

iCal to **transport**, nie provider — dlatego nie występuje na tej liście.

Adres importu (`importUrl`) traktujemy jak sekret: zwykle zawiera token w
ścieżce. Trzymamy go zaszyfrowany (AES-256-GCM), nie logujemy i nie zwracamy
w całości przez API — na zewnątrz idzie wyłącznie wersja zamaskowana.

ExternalCalendar jest **eventually consistent**: synchronizacja jest okresowa,
więc PostgreSQL może przez chwilę nie znać najświeższej zmiany w źródle.

---

## Booking.guestUserId

Powiązanie Booking z kontem — **opcjonalne**.

```text
guest_user_id = NULL       rezerwacja anonimowa
guest_user_id = User.id    rezerwacja przypisana do konta
```

My Trips czyta wyłącznie po `guest_user_id`. **Nigdy nie wyszukujemy Booking po
adresie email.**

---

## Guest snapshot

Dane podane przy składaniu konkretnego Booking:

```text
guest_name
guest_email
guest_phone
property_title_snapshot
property_city_snapshot
cover_image_url_snapshot
price snapshot
```

Snapshot **nie znika** po ustawieniu `guest_user_id` i **nie zmienia się**, gdy
User później edytuje profil. To zapis tego, co zostało uzgodnione, a nie kopia
aktualnych danych.

Dzięki snapshotowi podróż pozostaje czytelna także po zarchiwizowaniu Property.

---

## Booking claim

Bezpieczne przypisanie anonimowego Booking do konta.

**Nazwa kanoniczna:**

```text
claimBookingForCurrentUser
```

Wymaga **jednocześnie trzech rzeczy**:

```text
zalogowany User
+ ważny GuestBookingAccess token dla tego Booking
+ zgodny (znormalizowany) adres email
```

Czego **nie** wystarcza:

```text
sam publicReference   ← jest drukowany w mailu i dyktowany przez telefon
sam adres email       ← jest wiedzą publiczną
```

Claim jest idempotentny dla właściciela. Booking przypisany do innego User
zwraca `409 BOOKING_ALREADY_CLAIMED` — przejęcie jest niemożliwe.

---

## GuestBookingAccess

Sposób, w jaki Guest bez konta dostaje się do własnego Booking.

**Nazwa kanoniczna:**

```text
GuestBookingAccess
```

Rozróżnienie krytyczne:

```text
publicReference  = identyfikator  (jawny, drukowany w mailu, dyktowany przez telefon)
access token     = sekret         (32 bajty, hash w bazie, odwoływalny)
```

`publicReference` **nigdy** nie jest sekretem uwierzytelniającym. Sam numer
rezerwacji nie daje dostępu do niczego.

Token:

```text
>= 32 bajty entropii
w bazie wyłącznie hash
wymieniany na HttpOnly cookie, żeby zniknąć z adresu URL
odwoływalny
nie trafia do logów
```

---

## BookingEvent

Wpis w historii Booking.

**Nazwa kanoniczna:**

```text
BookingEvent
```

Typy: `BOOKING_CREATED`, `HOST_ACCEPTED`, `HOST_REJECTED`, `REQUEST_EXPIRED`,
`GUEST_CANCELLED`, `HOST_CANCELLED`, `HOLD_CREATED`, `HOLD_EXPIRED`,
`HOLD_RELEASED`.

Actor: `GUEST`, `HOST`, `SYSTEM`.

BookingEvent służy do audytu i osi czasu. **Nie jest źródłem prawdy o statusie** —
tym pozostaje `bookings.status`. Nie zapisujemy w nim sekretów ani pełnych
payloadów żądań.

---

## Booking status reason

Powód, dla którego Booking opuścił ścieżkę pozytywną. Zbiór zamknięty:

```text
GUEST_CANCELLED         gość anulował
HOST_CANCELLED          gospodarz anulował
HOST_REJECTED           gospodarz odrzucił prośbę
HOST_RESPONSE_TIMEOUT   gospodarz nie odpowiedział przed deadline
HOLD_EXPIRED            blokada terminu wygasła
AVAILABILITY_LOST       termin zajął się, zanim gospodarz odpowiedział
```

Nie używamy dowolnych stringów.

---

## Request expiration

Prośba o rezerwację ma **deadline** zapisany w kolumnie
`bookings.host_response_deadline_at`.

Baza jest źródłem prawdy: API odmawia akceptacji po deadline nawet wtedy, gdy
job wygaszający jeszcze się nie wykonał. Kolejka tylko domyka status.

Po upływie deadline:

```text
status       = EXPIRED
statusReason = HOST_RESPONSE_TIMEOUT
```

---

## Cancellation

Dwie komendy, oba kierunki:

```text
cancelBookingByGuest   → statusReason = GUEST_CANCELLED
cancelBookingByHost    → statusReason = HOST_CANCELLED
```

Dozwolone dla `PENDING_HOST_APPROVAL` i `PENDING_PAYMENT`.

Anulowanie `PENDING_PAYMENT` **musi** zwolnić `BookingHold` i usunąć jego
`AvailabilityBlock` — transakcyjnie, pod advisory lockiem Property. Inaczej
kalendarz zostałby zablokowany przez rezerwację, której już nie ma.

Anulowanie `CONFIRMED` jest poza zakresem, dopóki nie istnieją zwroty.

Obie komendy są idempotentne: anulowanie już anulowanej rezerwacji nic nie
zmienia i nie tworzy drugiego BookingEvent.

---

## Notification

Powiadomienie jest **side effectem**, nigdy częścią transakcji biznesowej.

```text
transakcja Booking + zapis do outboxa
        ↓ commit
outbox → BullMQ → email provider
```

Każde powiadomienie ma logiczny `dedupKey` (np. `booking-request-accepted:{id}`)
z unikalnym indeksem — ponowienie nie wysyła drugiego maila.

Poprawność Booking nie zależy od powodzenia wysyłki.

---

## CalendarExportToken

Odwoływalny sekret, pod którym Rezervio publikuje kalendarz Property jako feed
iCal dla systemów zewnętrznych.

**Nazwa kanoniczna:**

```text
CalendarExportToken
```

Zasady:

```text
token   >= 32 bajty entropii
w bazie zapisujemy wyłącznie hash tokena
raw token pokazujemy dokładnie raz, przy tworzeniu lub rotacji
rotacja unieważnia poprzedni token
```

Eksport obejmuje wyłącznie `HOST_BLOCK`.

Nigdy nie eksportujemy `EXTERNAL_CALENDAR` — odesłanie cudzej blokady do jej
własnego źródła powoduje pętlę, w której dwa kalendarze blokują się nawzajem
w nieskończoność.

Feed nie zawiera notatek Host, nazwy providera ani danych osobowych.

---

## ExternalInventoryConnection

Połączenie jednego `Host` z jednym zewnętrznym systemem — PMS albo channel
managerem.

**Nazwa kanoniczna:**

```text
ExternalInventoryConnection
```

Stany:

```text
PENDING
CONNECTED
DEGRADED           odpowiada, ale ostatnia synchronizacja nie powiodła się
DISCONNECTED
ACTION_REQUIRED    coś musi się wydarzyć poza Rezervio
```

Powód, dla którego połączenie nie jest po prostu `CONNECTED`, jest osobnym
polem — `PARTNER_ACCESS_REQUIRED` to nie awaria, tylko krok biznesowy, który
jeszcze się nie odbył.

Dane dostępowe trzymamy zaszyfrowane (AES-256-GCM), nie logujemy ich, nie
zwracamy przez API i nie pokazujemy w panelu — nawet zamaskowanych.

---

## ExternalPropertyMapping

Odpowiedniość: **jeden `Property` Rezervio ↔ jeden listing u dostawcy**.

**Nazwa kanoniczna:**

```text
ExternalPropertyMapping
```

Zawsze zatwierdzana przez `Host`. Dopasowanie po nazwie jest **propozycją**,
nigdy decyzją: pomyłka blokowałaby kalendarz nie tego obiektu, a pierwszą osobą,
która by to zauważyła, byłby gość stojący przed zajętym mieszkaniem.

Unikalna w obie strony — jeden obiekt do jednego listingu i odwrotnie.

---

## ExternalReservation

Rezerwacja, która istnieje w zewnętrznym systemie.

**Nazwa kanoniczna:**

```text
ExternalReservation
```

**To nie jest `Booking`.** Nie ma gościa Rezervio, ceny ustalonej przez nas ani
płatności, którą pobraliśmy. Tworzenie pełnego `Booking` dla każdej takiej
rezerwacji wymyślałoby wszystkie trzy rzeczy naraz.

W Rezervio jest **projekcją**: `ExternalReservationMapping` plus
`AvailabilityBlock` o źródle `EXTERNAL_PROVIDER`.

---

## ExternalReservationMapping

Powiązanie rezerwacji tam z rezerwacją tutaj.

**Nazwa kanoniczna:**

```text
ExternalReservationMapping
```

Kierunki:

```text
INBOUND    rezerwacja z zewnętrznego systemu, bez booking_id
OUTBOUND   Booking Rezervio przekazany dostawcy
```

Unikalna para `(connection, external reservation id)` sprawia, że powtórzony
webhook i nakładający się polling zbiegają się do jednego efektu. Częściowy
unikalny indeks na `(connection, booking_id)` dla `OUTBOUND` sprawia, że
ponowione przekazanie nie tworzy drugiej rezerwacji u dostawcy.

---

## PMS

Property Management System używany przez Host/operatora.

Przykłady:

```text
Smoobu
Beds24
Hostaway
```

Integracje ukrywamy za abstrakcją:

```text
InventoryProvider
```

Przykładowe adaptery:

```text
ManualInventoryProvider
ICalInventoryProvider
SmoobuInventoryProvider
Beds24InventoryProvider
HostawayInventoryProvider
```

Logika domenowa nie może być zależna od konkretnego PMS.

### PMS to nie to samo, co channel manager

Dwie różne relacje, nie dwa warianty tej samej:

```text
PMS              Rezervio dzwoni do cudzego systemu       (klient)
Channel manager  cudzy system dzwoni do Rezervio          (kanał)
```

W pierwszym przypadku Rezervio trzyma cudze dane dostępowe i pyta. W drugim
Rezervio **jest kanałem sprzedaży** i wystawia endpointy, które channel manager
odpytuje. Wciśnięcie obu w jeden interfejs produkuje metody, które po jednej
stronie nic nie znaczą.

---

# 3. Booking State Machine

Statusy kanoniczne:

```text
PENDING_HOST_APPROVAL
PENDING_PAYMENT
CONFIRMED
CANCELLED
EXPIRED
COMPLETED
```

## PENDING_HOST_APPROVAL

Prośba czeka na decyzję Host (`REQUEST_TO_BOOK`).

**Nie blokuje terminu.** Dopóki Host nie zaakceptuje, Property pozostaje
dostępne dla innych — inaczej niezdecydowany gospodarz zamrażałby kalendarz.

## PENDING_PAYMENT

Termin jest zabezpieczony aktywnym `BookingHold`, Booking czeka na płatność.

## CONFIRMED

Płatność się powiodła. Osiągalny **wyłącznie** przez Payment workflow.

## CANCELLED

Booking anulowany, np. odrzucony przez Host (`HOST_REJECTED`).

## EXPIRED

Hold wygasł (`HOLD_EXPIRED`) albo termin zajął się, zanim Host odpowiedział
(`AVAILABILITY_LOST`).

## COMPLETED

Stay się zakończył.

Dozwolone przejścia:

```text
PENDING_HOST_APPROVAL → PENDING_PAYMENT   (Host akceptuje)
PENDING_HOST_APPROVAL → CANCELLED         (Host odrzuca)
PENDING_HOST_APPROVAL → EXPIRED           (termin zajęty w międzyczasie)

PENDING_PAYMENT       → CONFIRMED         (płatność — Milestone 05)
PENDING_PAYMENT       → EXPIRED           (Hold wygasł)
PENDING_PAYMENT       → CANCELLED

CONFIRMED             → COMPLETED
CONFIRMED             → CANCELLED
```

`CANCELLED`, `EXPIRED` i `COMPLETED` są stanami końcowymi.

Nie ustawiamy statusów bezpośrednio z kontrolera i nie mamy generycznego
`updateBookingStatus`. Każde przejście to nazwana komenda:

```text
createBooking
acceptBookingRequest
rejectBookingRequest
expireBookingHold
releaseBookingHold
```

---

## BookingMode

Sposób, w jaki Property przyjmuje rezerwacje.

**Nazwa kanoniczna:**

```text
BookingMode
```

Wartości:

```text
REQUEST_TO_BOOK   domyślny — Host akceptuje każdą rezerwację
INSTANT_BOOK      Guest rezerwuje od razu
```

Tryb wybiera **backend** na podstawie Property. Klient nie może o niego
poprosić ani go pominąć.

---

# 4. Property Publication State

Status publikacji Property:

```text
DRAFT
IN_REVIEW
PUBLISHED
SUSPENDED
ARCHIVED
```

## DRAFT

Widoczne tylko dla Host/admin.

## IN_REVIEW

Wysłane do weryfikacji.

## PUBLISHED

Widoczne w publicznym wyszukiwaniu.

## SUSPENDED

Tymczasowo wyłączone.

## ARCHIVED

Nieaktywne historycznie.

Publiczny search zwraca wyłącznie:

```text
PUBLISHED
```

---

# 5. Reguły Availability

## A. Brak nakładających się rezerwacji

Dwa aktywne Booking dla tego samego Property nie mogą się nakładać.

Tam, gdzie to możliwe, chronimy ten warunek także na poziomie bazy danych.

Nie wystarcza:

```text
if available then insert booking
```

bez zabezpieczenia race condition.

---

## B. Zakres dat jest half-open

Zawsze:

```text
[checkIn, checkOut)
```

Booking kończący się 16 września nie blokuje nowego check-in 16 września.

Ta sama konwencja obowiązuje w bazie: `AvailabilityBlock.dateRange` to
PostgreSQL `daterange` z nawiasem `'[)'`, a overlap sprawdzamy operatorem `&&`.

Kanoniczna reguła dostępności ma jedną definicję:

```text
available = NOT EXISTS AvailabilityBlock overlapping requested Stay
```

Obowiązuje identycznie w Search, publicznym availability API, Property detail
i w przyszłej walidacji Booking. Nie tworzymy drugiej definicji overlap.

Availability modelujemy **zakresami**, nigdy wierszem na każdy dzień.

---

## C. BookingHold blokuje termin

Aktywny i niewygasły Hold jest traktowany jako brak dostępności.

---

## D. Wygasły Hold nie blokuje terminu

Availability nie może zależeć od tego, czy background job zdążył fizycznie usunąć wygasły rekord.

---

## E. Blokady zewnętrzne są osobnymi rekordami

Nie zamieniamy importów iCal/PMS w fikcyjne Booking.

Zachowujemy:

```text
sourceType
sourceId
externalCalendarId
```

To ułatwia synchronizację, debugging i usuwanie starych blokad.

---

# 6. Zasady finansowe

## Money

Nigdy nie używamy niekontrolowanego floating point dla pieniędzy.

Preferowane:

```text
amountMinor: integer
currency: ISO-4217
```

Przykład:

```text
192000 + PLN = 1 920,00 PLN
```

Alternatywnie bezpieczny `DECIMAL/NUMERIC`, jeśli stack obsługuje go poprawnie end-to-end.

---

## Currency

W domenie:

```text
PLN
EUR
USD
GBP
```

Nie:

```text
zł
€
$
```

Symbole są tylko prezentacją.

---

## Snapshot ceny

Potwierdzony Booking przechowuje snapshot finansowy:

```text
accommodationAmount
cleaningFee
serviceFee
taxAmount
discountAmount
grossAmount
platformFee
paymentFee
hostAmount
currency
```

Nie przeliczamy starych Booking na podstawie aktualnych DailyRate.

---

## PriceQuote expiry

Jeżeli cena może się zmienić pomiędzy search i checkout:

```text
PriceQuote.expiresAt
```

Booking powinien wskazywać zaakceptowany quote lub kopiować jego snapshot.

---

# 7. Daty i czas

## Daty pobytu

Stay używa lokalnych dat:

```text
LocalDate
```

np.:

```text
2026-09-12
2026-09-16
```

## Timestampy systemowe

UTC dla:

```text
createdAt
updatedAt
paidAt
cancelledAt
expiresAt
lastSyncAt
```

## Timezone Property

Property powinno posiadać:

```text
timeZone
```

np.:

```text
Europe/Warsaw
Europe/Madrid
```

Nie zakładamy jednej globalnej strefy.

---

# 8. Identyfikatory

Preferowane publiczne ID:

```text
UUID
```

lub:

```text
ULID
```

Nie wystawiamy sekwencyjnych DB IDs.

Property posiada:

```text
id
slug
```

Przykład:

```text
id   = 01J...
slug = baltic-loft-gdansk
```

`id` = tożsamość.

`slug` = routing/SEO.

---

# 9. API conventions

Plural resources:

```text
GET  /api/properties
GET  /api/properties/{id}
POST /api/bookings
GET  /api/bookings/{id}
```

Dla jawnych komend domenowych dopuszczamy:

```text
POST /api/bookings/{id}/cancel
POST /api/properties/{id}/publish
```

jeżeli zwykły PATCH zaciemniałby znaczenie operacji.

---

## Search API

Kanoniczny endpoint:

```text
GET /api/search
```

Przykładowe parametry:

```text
destination
checkIn
checkOut
adults
children
minPrice
maxPrice
propertyType
amenities
minRating
lat
lon
radius
```

Frontend labels nie są częścią kontraktu API.

API używa stabilnych wartości domenowych.

---

# 10. Event naming

Eventy nazywamy w czasie przeszłym.

Dobre:

```text
PropertyPublished
BookingHoldCreated
BookingConfirmed
BookingCancelled
PaymentSucceeded
PaymentFailed
RefundIssued
ExternalCalendarSynced
ExternalCalendarSyncFailed
```

Nie:

```text
ConfirmBooking
DoPayment
SyncCalendar
```

Te drugie są komendami.

Dla eventów serializowanych:

```text
property.published
booking.confirmed
payment.succeeded
calendar.sync_failed
```

---

# 11. Logowanie

Stosujemy structured logs.

Przykład:

```json
{
  "event": "booking.confirmed",
  "bookingId": "01J...",
  "propertyId": "01J...",
  "guestId": "01J...",
  "grossAmount": 192000,
  "currency": "PLN"
}
```

Nigdy nie logujemy:

- danych kart,
- haseł,
- access tokenów,
- dokumentów KYC,
- niepotrzebnych danych osobowych.

Do korelacji używamy ID.

---

# 12. Search

Kanoniczne nazwy:

```text
SearchRequest
SearchResult
SearchFilters
SearchSort
```

Sortowanie:

```text
RECOMMENDED
LOWEST_PRICE
HIGHEST_RATING
CLOSEST_TO_BEACH
BEST_VALUE
```

`BEST_VALUE` powinno mieć zdefiniowaną formułę/ranking.

Nie może być losowym badge marketingowym.

---

# 13. Zasady produktowe

## Total Price First

Najważniejsza cena w wynikach to cena całego pobytu.

## Map-First Discovery

Mapa i lista reprezentują ten sam zbiór SearchResult.

Selected Property na mapie = to samo Property na liście.

## AI Assists Search

AI może tłumaczyć natural language na SearchFilters.

Przykład:

```text
"basen, parking, maksymalnie 500 m od plaży"
```

→

```json
{
  "amenities": ["POOL", "PARKING"],
  "maxBeachDistanceMeters": 500
}
```

LLM nie generuje ofert.

Search engine jest źródłem prawdy o wynikach.

## Fair Ranking

Host nie może być niejawnie promowany tylko dlatego, że płaci wyższą prowizję.

Jeśli kiedyś powstanie placement sponsorowany, musi być jawnie oznaczony.

---

# 14. Zasady Host

Host może posiadać wiele Property.

Na MVP jedno Property ma jednego operacyjnego Host.

Co-hosting dodamy później.

Nie modelujemy przedwcześnie złożonej hierarchii własności.

Weryfikacja Host i publikacja Property to dwa niezależne stany.

Przykład:

```text
Host     = VERIFIED
Property = IN_REVIEW
```

jest poprawny.

---

# 15. Zasady Guest

Guest może wyszukiwać bez logowania.

Booking może wymagać danych Guest.

Dane potrzebne historycznie do Booking powinny być snapshottowane.

Nie polegamy wyłącznie na później edytowalnym profilu User.

---

# 16. PropertyImage

Kanoniczna nazwa:

```text
PropertyImage
```

Rekomendowane pola:

```text
id
propertyId
objectKey
url
position
altText
width
height
```

Kolejność jest jawna przez:

```text
position
```

Nie polegamy na kolejności inserta.

`position = 0` oznacza cover.

## objectKey

Zdjęcia trzymamy w **S3-compatible Object Storage**, nie jako blob w bazie.

```text
objectKey = tożsamość pliku w storage
url       = adres publiczny (może być wyliczany z objectKey)
```

`objectKey` jest source of truth dla operacji storage (upload, delete).

Klucz nadaje serwer, np.:

```text
properties/{propertyId}/{uuid}.{ext}
```

Nigdy nie używamy oryginalnej nazwy pliku jako finalnego klucza.

Upload odbywa się przez **presigned URL** — przeglądarka wysyła plik wprost do
storage, a backend zapisuje dopiero potwierdzony PropertyImage.

Presigned URL jest poświadczeniem: nie trafia do logów.

---

# 17. Integracje

Każda zewnętrzna integracja ma adapter.

Przykład:

```ts
interface InventoryProvider {
  getProperties(): Promise<ExternalProperty[]>
  getAvailability(...): Promise<ExternalAvailability>
  createReservation(...): Promise<ExternalReservation>
  cancelReservation(...): Promise<void>
}
```

Kod domenowy nie powinien wiedzieć, czy dane pochodzą z:

```text
iCal
Smoobu
Beds24
Hostaway
innego PMS
```

Tłumaczenie payloadów następuje na granicy integracji.

---

# 18. Source of Truth

Każdy obszar powinien mieć jawne źródło prawdy.

## Rezervio

Źródło prawdy dla:

```text
Rezervio Booking
PlatformFee
Listing publication state
lokalnego snapshotu Payment status
```

## PSP

Źródło prawdy dla:

```text
wykonania Payment
wykonania Refund
```

Wiarygodnym sygnałem jest **zweryfikowany podpisem webhook**, odebrany
server-side — nigdy komunikat z przeglądarki. Przeglądarka nie jest kanałem
zaufanym: każdy może wywołać nasze API i powiedzieć „zapłacone".

```text
client says success   → nic
verified webhook      → Booking CONFIRMED
```

Ten sam `provider_event_id` ma dawać dokładnie jeden efekt domenowy —
dostawcy dostarczają zdarzenia „co najmniej raz" i pozwalają je odtwarzać.

## PMS

Może być źródłem prawdy dla:

```text
inventory
external reservations
rates
```

zależnie od konfiguracji Host.

Nie tworzymy dwóch niejawnych source-of-truth.

---

# 19. Idempotency

Operacje, które mogą być retryowane, muszą być idempotentne.

Szczególnie:

```text
create payment
payment webhook
create PMS reservation
cancel PMS reservation
calendar sync
refund
```

Używamy tam, gdzie potrzeba:

```text
idempotencyKey
externalReference
processedEventId
```

Zakładamy, że webhook może:

- przyjść dwa razy,
- przyjść późno,
- przyjść w innej kolejności.

---

# 20. Auditability

Krytyczne operacje muszą być możliwe do odtworzenia.

Minimum:

```text
createdAt
updatedAt
createdBy
status history
payment reference
external reservation reference
```

Akcje admina wymagające audytu:

```text
refund
cancel
suspend property
override availability
manual payout action
```

---

# 21. Usuwanie danych

Nie hard-delete'ujemy bez potrzeby danych biznesowo-historycznych.

Preferujemy:

```text
ARCHIVED
CANCELLED
SUSPENDED
```

Usuwanie/anonymizacja danych User dla wymogów prywatności to osobny proces.

Booking i dane finansowe mogą podlegać obowiązkom retencji.

---

# 22. Granice MVP

MVP obsługuje:

```text
1 Property = 1 bookable unit
apartments
houses
villas
studios
manual property creation
daily rates
date-range availability
iCal sync
search
booking
payments w późniejszym milestone
```

MVP nie obsługuje:

```text
hotel room-type inventory
multiple identical rooms
flights
cars
activities
packages
loyalty points
full dynamic pricing engine
advanced promotions
co-host permission matrix
multi-currency settlement optimization
```

Nie tworzymy abstrakcji pod przyszłe funkcje bez bieżącej potrzeby.

---

# 23. Sugerowane granice modułów

Modular monolith:

```text
identity
hosts
properties
pricing
availability
search
bookings
payments
payouts
calendar-sync
notifications
admin
```

Unikamy circular dependencies.

---

# 24. Sugerowane agregaty

## Property aggregate

Odpowiada za:

```text
Property
PropertyImage
PropertyAmenity
publication state
basic listing data
```

Pricing i Availability mogą być osobnymi modułami.

## Booking aggregate

Odpowiada za:

```text
Booking
Stay
Guest snapshot
Booking status
financial snapshot
cancellation data
```

Payment może mieć osobny lifecycle/moduł.

Nie tworzymy jednego wielkiego agregatu:

```text
Host + Property + Price + Booking + Payment
```

---

# 25. Konwencje nazw w kodzie

Encje:

```text
Property
Booking
Payment
Host
Guest
```

Value Objects:

```text
Money
Stay
GeoPoint
DateRange
GuestCount
```

Serwisy:

```text
SearchService
PricingService
AvailabilityService
BookingService
```

Repozytoria:

```text
PropertyRepository
BookingRepository
```

Commands:

```text
CreateProperty
PublishProperty
CreateBookingHold
ConfirmBooking
CancelBooking
```

Queries:

```text
SearchProperties
GetProperty
GetBooking
```

Events:

```text
BookingConfirmed
PropertyPublished
PaymentSucceeded
```

---

# 26. Zakazane niejednoznaczne synonimy

Nie używamy wymiennie:

```text
Property / Listing / Offer
Booking / Reservation / Order
Host / Owner / Landlord
Guest / Customer / Tenant
DailyRate / Price / Fee
Payment / Payout / Settlement
Availability / Inventory
```

Jeżeli naprawdę pojawia się nowy koncept, najpierw definiujemy go w tym dokumencie.

---

# 27. Zasady bazy danych

Preferowane:

```text
snake_case tables
snake_case columns
foreign keys
NOT NULL domyślnie tam, gdzie ma sens
explicit unique constraints
explicit check constraints
UTC timestamps
```

Przykładowe constraints:

```text
check_out > check_in
amount >= 0
max_guests > 0
```

Invariantów nie chronimy tylko frontendem.

---

# 28. Frontend

Frontend może mieć ViewModel dopasowany do UI, ale nazwy domenowe powinny pozostać rozpoznawalne.

Dobre:

```ts
type PropertyCardViewModel = {
  propertyId: string
  title: string
  totalPrice: MoneyView
  saving?: MoneyView
}
```

Unikamy bez potrzeby:

```text
OfferTile
AccommodationProduct
TravelItem
```

---

# 29. Kluczowe business invariants

1. Confirmed Booking musi wskazywać istniejące Property.
2. `checkOut > checkIn`.
3. Liczba Guest nie może przekraczać `Property.maxGuests`.
4. Dwa aktywne Booking dla tego samego Property nie mogą się nakładać.
5. Niewygasły BookingHold blokuje termin.
6. Publiczne Property musi mieć status `PUBLISHED`.
7. Snapshot finansowy Booking nie może zmienić się niejawnie po potwierdzeniu.
8. Payment success potwierdzamy server-side.
9. Obowiązkowe opłaty pokazujemy przed potwierdzeniem Booking.
10. Calendar/PMS sync failure musi być obserwowalny i retryowalny.
11. Pieniędzy nie liczymy unsafe floating-point arithmetic.
12. Search nie może zwracać zmyślonej Availability.

---

# 30. Reguła dodawania nowych konceptów

Przed dodaniem nowej encji/terminu odpowiedz:

1. Czy to faktycznie nowy koncept biznesowy?
2. Czy istniejący termin nie opisuje go poprawnie?
3. Czy ma własny lifecycle?
4. Czy potrzebuje własnej persistence?
5. Czy osoba produktowa/Host rozumie tę różnicę?

Jeżeli większość odpowiedzi brzmi „nie” — nie dodawaj nowej encji.

Preferuj prostszy model.

---

# 31. Quick Reference

| Pojęcie biznesowe | Nazwa w kodzie |
|---|---|
| użytkownik (wspólna tożsamość) | `User` |
| przypisanie rezerwacji do konta | `Booking.guestUserId` |
| sesja logowania | `UserSession` |
| gość | `Guest` |
| gospodarz/operator | `Host` |
| obiekt | `Property` |
| publiczna prezentacja | `Listing` |
| pobyt | `Stay` |
| dostępność | `Availability` |
| blokada terminu | `AvailabilityBlock` |
| cena za noc/dzień | `DailyRate` |
| kalkulacja ceny | `PriceQuote` |
| rezerwacja | `Booking` |
| blokada checkoutu | `BookingHold` |
| tryb rezerwacji | `BookingMode` |
| prośba o akceptację | `BookingRequest` |
| płatność gościa | `Payment` |
| wypłata Host | `Payout` |
| prowizja Rezervio | `PlatformFee` |
| zwrot | `Refund` |
| reguły anulowania | `CancellationPolicy` |
| zdjęcie obiektu | `PropertyImage` |
| udogodnienie | `Amenity` |
| zewnętrzny kalendarz | `ExternalCalendar` |
| dostęp gościa do rezerwacji | `GuestBookingAccess` |
| wpis historii rezerwacji | `BookingEvent` |
| token eksportu iCal | `CalendarExportToken` |
| adapter PMS/inventory | `InventoryProvider` |

---

# 32. Finalna zasada architektoniczna

> **Preferuj jawny język domenowy i prosty model nad generyczne abstrakcje.**

Rezervio MVP optymalizujemy pod:

```text
clarity
correctness
speed of iteration
observability
easy future extraction
```

Nie pod teoretyczną perfekcję architektury.

Pozostajemy przy **modular monolith**, dopóki skala lub granice zespołów nie uzasadnią wydzielania usług.
