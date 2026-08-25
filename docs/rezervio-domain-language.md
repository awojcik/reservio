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

Osoba posiadająca konto w Rezervio.

User może być:

- Guest,
- Host,
- jednocześnie Guest i Host.

Nie tworzymy osobnych tożsamości logowania dla Guest i Host.

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

## Guest

User, który wyszukuje Property i dokonuje Booking.

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
MAINTENANCE
```

**Nazwa kanoniczna:**

```text
AvailabilityBlock
```

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

Przykładowy TTL:

```text
10 minut
```

Aktywny BookingHold blokuje kolidujące terminy.

Wygasły BookingHold nie wpływa na Availability.

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

---

## Payout

Wypłata środków należnych Host.

**Nazwa kanoniczna:**

```text
Payout
```

Nie używamy `Payment` dla wypłaty do Host.

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

Cancellation Booking i Refund są powiązane, ale nie są tym samym procesem.

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
ICAL
AIRBNB
BOOKING
PMS
OTHER
```

Provider jest metadanym integracji, a nie częścią modelu Availability.

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

---

# 3. Booking State Machine

Rekomendowane statusy MVP:

```text
DRAFT
PENDING
HOLD
CONFIRMED
CANCELLED
EXPIRED
COMPLETED
```

## DRAFT

Nieukończony flow.

## PENDING

BookingRequest czekający na decyzję Host.

## HOLD

Termin tymczasowo zablokowany.

## CONFIRMED

Booking potwierdzony.

## CANCELLED

Booking anulowany.

## EXPIRED

Flow/Hold wygasł przed potwierdzeniem.

## COMPLETED

Stay już się zakończył.

Przykładowe przejścia:

```text
DRAFT
  ↓
HOLD
  ↓
CONFIRMED
  ↓
COMPLETED
```

Request-to-book:

```text
PENDING
  ↓
CONFIRMED
```

Wygaśnięcie:

```text
HOLD
  ↓
EXPIRED
```

Anulowanie:

```text
PENDING   → CANCELLED
HOLD      → CANCELLED
CONFIRMED → CANCELLED
```

Nie ustawiamy dowolnych statusów bezpośrednio z kontrolera.

Przejścia statusów należą do logiki domenowej/aplikacyjnej.

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
| użytkownik | `User` |
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
| prośba o akceptację | `BookingRequest` |
| płatność gościa | `Payment` |
| wypłata Host | `Payout` |
| prowizja Rezervio | `PlatformFee` |
| zwrot | `Refund` |
| reguły anulowania | `CancellationPolicy` |
| udogodnienie | `Amenity` |
| zewnętrzny kalendarz | `ExternalCalendar` |
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
