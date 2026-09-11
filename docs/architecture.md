# Architektura Rezervio

## Warstwy

```text
Next.js      → presentation / web
NestJS       → application API
PostgreSQL   → transactional source of truth
PostGIS      → geo
PostgreSQL FTS + pg_trgm → obecny search
pgvector     → fundament pod przyszły semantic search
S3-compatible Object Storage → zdjęcia Property
Redis + BullMQ → kolejki w tle: kalendarze, wygasanie Holdów, powiadomienia
SMTP           → email (lokalnie Mailpit)
```

Architektura to **modular monolith**. Nie ma mikroserwisów i na tym etapie nie ma
potrzeby, żeby były.

## Przepływ danych

```text
przeglądarka
    ↓ HTTP (REST, JSON)
Next.js (SSR + client)
    ↓ HTTP
NestJS / Fastify
    ↓ Drizzle + jawny SQL
PostgreSQL
```

Frontend **nigdy** nie łączy się z bazą. Nie importuje też kodu backendu: kontrakt
przechodzi przez OpenAPI do `packages/api-client`, z którego generowane są typy.

```text
DB record → mapper → API DTO → OpenAPI → typy klienta → komponenty
```

## Tożsamość i sesje

Jedna tożsamość logowania — `User` — może występować jako Guest, jako Host albo
jako jedno i drugie. `Host` jest **profilem** powiązanym z `User`, nie osobnym
kontem.

```text
User
├── My Trips              (przez Booking.guestUserId)
└── Host Profile          (opcjonalny)
    └── Host Dashboard
```

Dwie ścieżki rejestracji, jedna tożsamość:

```text
POST /api/auth/register        → User
POST /api/auth/register/host   → User + profil Host
```

Logowanie jest wspólne. Nie ma dwóch systemów auth ani dwóch rodzajów sesji.
`GET /api/auth/me` zwraca `host: null` dla konta bez profilu gospodarza — to
poprawna odpowiedź, nie błąd.

### Konto nie jest barierą wejścia

Rezerwacja bez rejestracji działa i ma działać dalej:

```text
guest_user_id = NULL
guest snapshot = zapisany
```

Zalogowany User dostaje dodatkowo `guest_user_id`. Snapshot powstaje zawsze.

### Snapshot kontra profil

To dwie różne rzeczy i celowo się nie synchronizują:

```text
profil User    = kim jesteś dzisiaj
Booking snapshot = co zostało uzgodnione wtedy
```

Edycja profilu nie zmienia historycznych rezerwacji. Dzięki snapshotowi
(`property_title`, `property_city`, `cover_image_url`, cena) podróż pozostaje
czytelna nawet po zarchiwizowaniu obiektu przez gospodarza.

### Bezpieczny claim

Anonimowy Booking można przypiąć do konta **wyłącznie** po spełnieniu trzech
warunków naraz:

```text
zalogowany User
+ ważny GuestBookingAccess token tego Booking
+ zgodny adres email
```

Automatyczne linkowanie po samym adresie email byłoby dziurą: adres jest wiedzą
publiczną, a `publicReference` trafia do maila i bywa dyktowany przez telefon.
Żadne z nich nie autoryzuje niczego.

Booking należący już do innego konta zwraca `409 BOOKING_ALREADY_CLAIMED`.

### My Trips

Czyta po `bookings.guest_user_id` z indeksem, nigdy po adresie email.
Paginacja jest keysetowa na `(created_at, id)`, więc kursor pozostaje poprawny,
gdy dochodzą nowe rezerwacje.

Kategorie (`PENDING`, `UPCOMING`, `PAST`, `CANCELLED`) to **grupowanie
prezentacyjne** wyliczane ze statusu i dat — nie zapisujemy ich jako statusu
Booking, bo podróż przechodzi z `UPCOMING` do `PAST` samym upływem czasu.

### Rezerwacja własnego obiektu

Zablokowana po stronie backendu (`409 CANNOT_BOOK_OWN_PROPERTY`). Ukrycie
przycisku nie powstrzymałoby bezpośredniego wywołania API.

Sesje są **opaque i server-side**. Nie ma JWT: token to 32 losowe bajty, w bazie
leży wyłącznie jego SHA-256, a transportem jest `HttpOnly` cookie.

```text
przeglądarka
    ↓ HttpOnly cookie (rezervio_session)
NestJS
    ↓ SHA-256(token)
user_sessions → users → hosts
```

Powody tego wyboru:

- unieważnienie sesji jest natychmiastowe — bez czekania na wygaśnięcie tokena;
- wyciek bazy nie daje działających sesji, tak samo jak nie daje haseł;
- frontend nigdy nie czyta ani nie dekoduje cookie — stan zalogowania pochodzi
  wyłącznie z `GET /api/auth/me`.

Hasła: **Argon2id** (19 MiB, t=2, p=1), minimum 10 znaków.

Tożsamość Host **nigdy** nie pochodzi z żądania:

```text
Session → User → Host
```

`hostId` przysłany przez klienta jest ignorowany. Cudze `Property` zwraca `404`,
nie `403` — `403` potwierdzałby, że dany obiekt istnieje.

## Publikacja jako komenda domenowa

Zmiana statusu nie jest zwykłym `PATCH`:

```text
POST /api/host/properties/{id}/publish
POST /api/host/properties/{id}/unpublish
POST /api/host/properties/{id}/archive
```

Backend jest jedynym źródłem prawdy dla reguł publikacji. `publishReadiness`
w Host DTO to ta sama funkcja, którą wykonuje `publish` — frontend ją renderuje,
ale o niczym nie decyduje.

```text
DRAFT ──publish──▶ PUBLISHED ──unpublish──▶ SUSPENDED
  │                    │                        │
  └────────────────────┴────archive─────────────┴──▶ ARCHIVED
```

`ARCHIVED` jest stanem końcowym — danych nie usuwamy twardo.

## Zdjęcia i object storage

Zdjęcia nie przechodzą przez API i nie leżą w PostgreSQL:

```text
przeglądarka
    ↓ POST .../images/upload-url
NestJS                       (podpisuje URL, nie widzi pliku)
    ↓ presigned PUT
Object Storage
    ↓ POST .../images
NestJS → PropertyImage w PostgreSQL
```

Klucz obiektu nadaje serwer (`properties/{propertyId}/{uuid}.{ext}`), więc
potwierdzony upload nie może trafić pod cudze `Property`. Oryginalna nazwa pliku
nigdy nie jest kluczem.

Abstrakcja `ObjectStorage` ma trzy metody — `createPresignedUpload`,
`deleteObject`, `getPublicUrl` — dzięki czemu MinIO lokalnie i DigitalOcean
Spaces produkcyjnie są dla domeny tym samym.

Transakcja bazodanowa **nigdy** nie obejmuje wywołania sieciowego do storage.
Przy usuwaniu zdjęcia najpierw commitujemy zmianę w bazie, a dopiero potem
kasujemy plik; osierocony plik jest logowany i nieszkodliwy, natomiast błąd
storage nie może uszkodzić stanu Property.

## Availability

> **PostgreSQL jest source of truth dla Availability.**
> **Redis/BullMQ służy wyłącznie do synchronizacji.**
> **iCal jest źródłem eventually consistent.**

Cała niedostępność mieszka w jednej tabeli `availability_blocks`, niezależnie
od tego, skąd pochodzi:

```text
HOST_BLOCK          ręczna blokada gospodarza
EXTERNAL_CALENDAR   zaimportowane z cudzego feedu iCal
BOOKING / BOOKING_HOLD / MAINTENANCE   przewidziane w schemacie, jeszcze nieużywane
```

Dzięki temu pytanie „czy ten Property jest wolny?" to jedno zapytanie, a nie
suma kilku źródeł.

### Half-open i daterange

Zakresy są półotwarte — `[startDate, endDate)` — i przechowywane jako
PostgreSQL `daterange` z nawiasem `'[)'`:

```sql
date_range && daterange(:startDate, :endDate, '[)')
```

Blokada kończąca się 16 września **nie** koliduje z pobytem zaczynającym się
16 września. To najczęstsze źródło błędów off-by-one w systemach rezerwacyjnych,
więc konwencja jest jedna i egzekwowana aż do poziomu kolumny.

Indeks GiST na `(property_id, date_range)` sprawia, że overlap jest wyszukiwaniem
indeksowym, a nie skanem.

Availability modelujemy zakresami. **Nie ma** tabeli z wierszem na każdy dzień.

### Jedna definicja dostępności

```text
available = NOT EXISTS AvailabilityBlock overlapping requested Stay
```

Ta sama funkcja (`overlapCondition`) buduje warunek w Search, w publicznym
availability API i w Property detail. Search dokłada ją do tego samego zapytania
SQL — nic nie jest filtrowane w Node, inaczej `total` byłby nieprawdziwy,
a indeks bezużyteczny.

### Import iCal jako snapshot reconciliation

Feed traktujemy jako **pełny obraz** stanu w danym horyzoncie, nie jako strumień
zdarzeń:

```text
fetch → parse → normalize        (poza transakcją, sieć)
        ↓
reconcile: insert / update / delete   (jedna transakcja)
```

Kolejność jest istotna. Rekoncyliacja rusza dopiero po **udanym** pobraniu
i sparsowaniu, dzięki czemu nieudana synchronizacja zostawia poprzedni snapshot
nienaruszony. Property nie staje się nagle wolne dlatego, że cudzy serwer miał
gorszą minutę.

Transakcja bazodanowa nigdy nie obejmuje wywołania sieciowego.

### SSRF

Host podaje URL, który backend pobiera — to klasyczna powierzchnia SSRF.
Sprawdzamy trzykrotnie: schemat i host przed połączeniem, każdy adres zwrócony
przez DNS, i to samo ponownie przy każdym przekierowaniu. Wynik DNS jest
przypinany do gniazda, więc nazwa nie może się przerobić między walidacją
a połączeniem. Endpointy metadanych chmury są odrzucane zawsze, także
w developmencie.

### Kolejka

```text
periodic sweep → znajdź ACTIVE kalendarze do odświeżenia → po jednym jobie na kalendarz
```

Jeden job na kalendarz, nie jeden wielki job: wolny feed nie opóźnia wtedy
wszystkich pozostałych. Błędy trwałe (odrzucenie bezpieczeństwa, nieparsowalny
feed) nie są ponawiane — powtórzenie da ten sam wynik i tylko obciąży cudzy
serwer.

### Eksport

Eksport iCal obejmuje wyłącznie `HOST_BLOCK`. Odesłanie zaimportowanej blokady
do jej własnego źródła tworzyłoby pętlę, w której dwa kalendarze blokują się
nawzajem bez końca.

### Uwaga na przyszły Booking

> Przyszły flow Booking musi **zawsze** ponownie sprawdzić Availability
> w PostgreSQL przed utworzeniem BookingHold. iCal jest eventually consistent,
> więc brak kolizji sprzed minuty nie jest gwarancją teraz.

## Rezerwacje i współbieżność

> **Rezervio nie może przyjąć dwóch nakładających się rezerwacji tego samego
> Property wskutek race condition.**

To najważniejsza właściwość całego systemu i jedyna, której nie wolno oprzeć
na frontendzie, cache'u ani na tym, że „raczej się nie zdarzy".

### Dlaczego samo sprawdzenie nie wystarcza

```text
Guest A: czy wolne? → tak
Guest B: czy wolne? → tak      ← oba czytają przed jakimkolwiek zapisem
Guest A: rezerwuje
Guest B: rezerwuje             ← double booking
```

Odstęp między odczytem a zapisem to mikrosekundy, ale wystarczy.

### Advisory lock per Property

```text
BEGIN
  pg_advisory_xact_lock(namespace, hashtext(propertyId))   ← pierwsza instrukcja
  przeładuj Property, sprawdź PUBLISHED i pojemność
  PONOWNIE sprawdź Availability
  policz cenę
  utwórz Booking
  utwórz BookingHold
  utwórz AvailabilityBlock(BOOKING_HOLD)
COMMIT
```

Drugi Guest czeka na locku, po czym widzi już Hold pierwszego i dostaje `409
PROPERTY_NOT_AVAILABLE`.

Lock jest:

- **per Property** — dwie różne oferty nie blokują się nawzajem;
- **transakcyjny** — zwalniany przy COMMIT albo ROLLBACK, więc nie ma czego
  wycieknąć, gdy request umrze w połowie;
- **w PostgreSQL, nie w Redisie** — źródłem prawdy jest ta sama baza, w której
  siedzą dane.

Ten sam wzorzec obowiązuje **każdy** zapis zmieniający dostępność: ręczna
blokada Host, zdjęcie blokady, rekoncyliacja kalendarza zewnętrznego, akceptacja
prośby i wygaszanie Holdu.

W transakcji nie ma żadnych wywołań sieciowych.

### Rewalidacja

Dostępność sprawdzona podczas Search jest bezwartościowa w momencie zapisu.
Każde tworzenie Holdu sprawdza ją **ponownie, wewnątrz transakcji, pod lockiem**.

### Cykl życia BookingHold

```text
REQUEST_TO_BOOK:
  PENDING_HOST_APPROVAL          ← bez Holdu, kalendarz zostaje otwarty
        ↓ Host akceptuje (rewalidacja!)
  PENDING_PAYMENT + ACTIVE Hold

INSTANT_BOOK:
  PENDING_PAYMENT + ACTIVE Hold  ← od razu, w jednej transakcji
```

Prośba o rezerwację celowo **nie** blokuje terminu: gospodarz zwlekający dobę
zamroziłby kalendarz, nie podejmując żadnej decyzji.

### Wygasły Hold przestaje blokować natychmiast

```sql
ab.booking_hold_id IS NULL
OR (bh.status = 'ACTIVE' AND bh.expires_at > now())
```

Availability nie ufa samemu wierszowi blokady — dołącza Hold i sprawdza, czy
wciąż żyje. Dzięki temu spóźniony worker nie potrafi zablokować Property ani
sekundy dłużej niż TTL.

BullMQ jedynie **sprząta**: przestawia statusy i kasuje wiersze. Gdyby kolejka
zniknęła w całości, dostępność pozostaje poprawna.

### Idempotency

`POST /api/bookings` wymaga `Idempotency-Key`. Klucz i hash żądania lądują
w PostgreSQL, nie w Redisie — poprawność nie może zależeć od cache'u.

```text
ten sam klucz + te same dane  → ta sama rezerwacja
ten sam klucz + inne dane     → 409
```

Zapisujemy wyłącznie hashe, nigdy treści żądania: zawiera dane kontaktowe gościa.

### Przejście do potwierdzenia

```text
PENDING_PAYMENT
      ↓ zweryfikowany webhook o udanej płatności
CONFIRMED
      ↓
AvailabilityBlock: BOOKING_HOLD → BOOKING   (jedna transakcja, ten sam lock)
```

Szczegóły w rozdziale [Płatności i potwierdzenie rezerwacji](#płatności-i-potwierdzenie-rezerwacji).

## Powiadomienia jako side effect

> **Transakcja Booking nigdy nie zależy od SMTP.**

Email jest konsekwencją zmiany stanu, nie jej częścią. Gdyby wysyłka była
w transakcji, chwilowa awaria serwera pocztowej zablokowałaby rezerwację —
a to najgorszy możliwy kompromis.

### Transakcyjny outbox

```text
transakcja:
  zmiana Booking
  wpis BookingEvent
  wpis OutboxEvent          ← intencja powiadomienia
commit
        ↓
outbox pump → BullMQ → email provider
```

Sam `queue.add()` po commicie ma lukę: crash pomiędzy commitem a wywołaniem
gubi powiadomienie bez śladu. Zapis intencji **w tej samej transakcji** tego nie
może (milestone 05 §44).

Payload w outboxie zawiera wyłącznie identyfikatory. Dane gościa nie przechodzą
przez Redis — worker doczytuje je z bazy.

### Dedup

Każde powiadomienie ma logiczny klucz, np.:

```text
booking-request-accepted:{bookingId}
```

`notification_deliveries.dedup_key` jest unikalny, więc **zajęcie wiersza jest
pozwoleniem na wysyłkę**. Ponowiony job, przepompowany outbox i podwójny
enqueue liczą ten sam klucz — przechodzi tylko pierwszy.

Błąd trwały (SMTP 5xx, odrzucony adres) oznacza wiersz jako `FAILED` i kończy
temat. Błąd chwilowy (4xx) wraca do kolejki z backoffem.

### Provider

```ts
interface EmailProvider { send(message: EmailMessage): Promise<void> }
```

Lokalnie SMTP celuje w Mailpit, który przechwytuje wszystko — żaden testowy
mail nie wyjdzie na świat. Podmiana na Resend czy SES to zmiana
infrastrukturalna; `BookingService` nigdy nie dowiaduje się, co jest pod spodem.

## Dostęp gościa do rezerwacji

Guest nie ma konta, a mimo to musi widzieć własną rezerwację i móc ją anulować.

```text
publicReference  = identyfikator (jawny)
access token     = sekret        (32 bajty, hash w bazie)
```

Numer rezerwacji trafia do maila i bywa dyktowany przez telefon — nie może
niczego autoryzować. Token jest wymieniany na `HttpOnly` cookie przy pierwszym
wejściu, po czym znika z adresu URL, żeby nie osiadł w historii przeglądarki ani
w nagłówku `Referer`.

Token powstaje już przy tworzeniu rezerwacji, więc gość widzi ją natychmiast po
wysłaniu formularza, nie dopiero po nadejściu maila.

## Wygasanie próśb i anulowanie

Deadline odpowiedzi gospodarza leży w kolumnie
`bookings.host_response_deadline_at`, nie w opóźnionym jobie.

```text
API sprawdza deadline przy każdej akceptacji
→ spóźniony worker nie może przepuścić prośby, która już wygasła
```

Job i okresowy sweep tylko domykają status. Gdyby Redis zniknął, reguła
biznesowa nadal obowiązuje.

Anulowanie `PENDING_PAYMENT` — z obu stron — zwalnia `BookingHold` i usuwa jego
`AvailabilityBlock` w jednej transakcji, pod advisory lockiem Property. Termin
wraca do puli od razu.

## Read modele panelu gospodarza

> Pulpit i wspólny kalendarz są **projekcjami odczytu** nad PostgreSQL.
> Nie istnieje tabela stanu pulpitu.

Gdyby stan pulpitu był materializowany, mielibyśmy drugie źródło prawdy, które
prędzej czy później rozjedzie się z rezerwacjami i blokadami, które opisuje.
Dlatego `HostOperationsService` i `HostCalendarService` tylko czytają — nie
zapisują nic i nie mają własnych komend.

### Agregacja pulpitu

`GET /api/host/dashboard` odpowiada na całe pytanie „co dziś muszę zrobić”
w jednym żądaniu. Kilkanaście osobnych zapytań z przeglądarki dałoby ten sam
obraz, ale w kilkunastu rundach sieciowych i bez wspólnego momentu w czasie.

Serwis wykonuje równolegle kilka zapytań, po jednym na sekcję:

| Sekcja | Reguła |
| --- | --- |
| Attention | prośby czekające na decyzję, obiekty i kalendarze wymagające ruchu |
| Today | `CONFIRMED` z `check_in` lub `check_out` równym dzisiaj |
| Pending requests | `PENDING_HOST_APPROVAL`, `host_response_deadline_at ASC NULLS LAST` |
| Upcoming stays | `CONFIRMED`, `check_in >= dziś`, rosnąco |
| Properties | `GROUP BY status` |
| Calendar sync | stan `ExternalCalendar` |

„Dzisiaj” liczy się w `Property.timeZone`, nie w strefie serwera — gospodarz
z obiektem w innej strefie widzi swój dzień, nie nasz.

Attention nie ma własnej definicji gotowości do publikacji ani własnej
definicji „nieświeżego” kalendarza: pierwsza pochodzi z `evaluatePublishReadiness`,
ta sama, której używa komenda publikacji, druga z interwału synchronizacji iCal.
Dwie definicje tego samego pojęcia zawsze zaczynają się różnić.

### Projekcja wspólnego kalendarza

`GET /api/host/calendar` zwraca `AvailabilityBlock` wszystkich obiektów
gospodarza pogrupowane po Property — dwa zapytania niezależnie od liczby
obiektów: jedno po obiekty, jedno po wszystkie zdarzenia w oknie. Nie ma pętli
po Property, więc nie ma N+1.

Widoczność zdarzenia rządzi się tym samym predykatem, co dostępność: blokada
związana z wygasłym `BookingHold` nie jest zdarzeniem, dokładnie tak samo jak
nie blokuje rezerwacji. Kalendarz nie może pokazywać terminu jako zajętego,
gdy wyszukiwarka pokazuje go już jako wolny.

Dla `EXTERNAL_CALENDAR` nazwa gościa i numer rezerwacji są zawsze `null`.
Treść cudzego feedu iCal potrafi zawierać dane osobowe, których nie mamy
podstaw pokazywać — gospodarz widzi „Niedostępne — Booking.com”.

Blokowanie i zwalnianie terminu z tego widoku wywołuje istniejące endpointy
Availability. Cała logika nakładania się i dzielenia zakresów pozostaje w jednym
miejscu.

### Read-side SQL

Zapytania read-side są pisane ręcznie (`db.execute`), bo agregują kilka tabel
i muszą trafiać w indeksy. Ma to jeden efekt uboczny: `db.execute` omija mappery
kolumn Drizzle, więc `timestamptz` wraca jako łańcuch znaków. Konwersja jest
w `common/pg-values.ts` — jedno miejsce zamiast rzutowania przy każdym odczycie.

Indeksy dodane pod te ekrany:

| Indeks | Zapytanie |
| --- | --- |
| `bookings_host_status_check_in_idx` | Today, upcoming stays, filtr zakresu dat |
| `bookings_host_check_out_idx` | wyjazdy |

Wyszukiwanie rezerwacji po numerze, imieniu i emailu jest zawsze zawężone do
`host_id`, więc nawet `LIKE '%…%'` czyta wyłącznie rezerwacje jednego gospodarza.

## Płatności i potwierdzenie rezerwacji

> **Pieniądze są uznane dopiero po wiarygodnym, zweryfikowanym sygnale
> server-side od dostawcy płatności.**

Przeglądarka nie jest kanałem zaufanym. Każdy potrafi wywołać nasze API
i powiedzieć „zapłacone" — gdyby to wystarczało do `CONFIRMED`, cały system
rezerwacji byłby darmowy.

```text
client says success   → nic
verified webhook      → Booking CONFIRMED
```

### Granica PaymentProvider

Domena nie zna Stripe'a. Rozmawia z interfejsem:

```text
createPayment
cancelPayment
createRefund
verifyEvent
createConnectedAccount / createOnboardingLink / getAccount
```

`StripePaymentProvider` jest jedyną klasą, która wie, jak nazywa się dostawca,
i jedyną, która widzi jego typy. Testy podstawiają pod ten sam token atrapę
i przechodzą cały przepływ — łącznie z weryfikacją podpisu — bez sieci.

To nie jest framework multi-PSP. To szew, dzięki któremu „rezerwacja jest
potwierdzona, bo płatność się powiodła" nie znaczy „bo pewien dostawca
powiedział pewne słowo".

### Sandbox kontra live

Development i testy działają wyłącznie na kluczach testowych. Klucz i sekret
webhooka pochodzą z konfiguracji (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`), nigdy z kodu, a lokalny przepływ nie wymaga żadnego
publicznego wdrożenia — Stripe CLI przekierowuje zdarzenia na localhost.

Rezervio nigdy nie widzi numeru karty, CVC ani daty ważności: dane wpisywane są
w ramce dostawcy (Stripe Elements) i lecą prosto do niego. Własne pola na numer
karty wciągnęłyby całą aplikację w zakres PCI bez żadnej korzyści.

### Granica sieci

```text
odczyt i walidacja w bazie
        ↓
wywołanie API dostawcy        ← poza transakcją
        ↓
krótka transakcja: zapis stanu od dostawcy
```

Wywołanie sieciowe wewnątrz otwartej transakcji trzymałoby blokady wierszy
przez czas round-tripu, a timeout wycofałby zapis o PaymentIncie, który
naprawdę istnieje. Zamiast pseudo-rozproszonej transakcji używamy lokalnego
ACID, idempotency po stronie dostawcy, webhooków i odzyskiwania przez kolejkę.

Każde mutujące wywołanie dostawcy niesie stabilny klucz idempotency wyprowadzony
z naszego własnego identyfikatora:

```text
payment-create:{paymentId}
payment-cancel:{paymentId}
refund:{refundId}
```

Ponowienie tej samej operacji nie tworzy drugiego efektu.

### Idempotencja zdarzeń

Dostawcy dostarczają zdarzenia „co najmniej raz" i pozwalają je odtwarzać
ręcznie. `payment_provider_events` z unikalnym `(provider, provider_event_id)`
zamienia to na dokładnie jeden efekt domenowy: wstawienie wiersza jest
pozwoleniem na przetworzenie, a duplikat dostaje `200 OK` i nic nie robi.

### Atomowa konwersja Hold → Booking

To najważniejszy invariant tego etapu.

```text
BEGIN
  pg_advisory_xact_lock(namespace, hashtext(propertyId))
  przeładuj Booking, BookingHold, Payment
  jeśli Booking już CONFIRMED → nic

  Payment      → SUCCEEDED
  Booking      → CONFIRMED
  BookingHold  → CONVERTED
  AvailabilityBlock: BOOKING_HOLD → BOOKING   ← UPDATE, nie DELETE + INSERT
COMMIT
```

Blokada jest **przepisywana w miejscu**. Skasowanie jej i wstawienie nowej —
choćby w tej samej transakcji — byłoby kuszące, ale sekwencja

```text
usuń BOOKING_HOLD → COMMIT → utwórz BOOKING
```

otwiera okno, w którym termin wygląda na wolny. Ten sam advisory lock bierze
też wygaszanie Holdu i tworzenie rezerwacji, więc nikt nie prześlizgnie się
w trakcie.

Potwierdzona rezerwacja blokuje kalendarz przez wiersz `BOOKING` z `booking_id`
— bez terminu ważności i bez joinu do sprawdzenia. Redis może zniknąć w całości;
`CONFIRMED` nadal blokuje termin.

### Wyścig: wygaśnięcie Holdu kontra udana płatność

Oba przepływy biorą ten sam lock, więc PostgreSQL je szereguje. Zwycięzca
decyduje o wyniku, ale wynik zawsze jest spójny:

| Kto pierwszy | Booking | Payment | Refund |
| --- | --- | --- | --- |
| webhook | `CONFIRMED` | `SUCCEEDED` | brak |
| wygaśnięcie | `EXPIRED`, reason `PAYMENT_AFTER_HOLD_EXPIRY` | `SUCCEEDED` | jeden pełny |

Nigdy nie zdarza się „potwierdzona rezerwacja *i* zwrot".

Spóźniona płatność jest prawdziwa, a termin już nie — dlatego pieniądze wracają,
zamiast potwierdzać pobyt, którego ktoś inny mógł już zarezerwować.

### Odzyskiwanie przez Refund

`refunds` z unikalnym `(payment_id, reason)` sprawia, że „spóźniona płatność jest
zwracana dokładnie raz" jest gwarancją bazy danych, a nie nadzieją: dwie ścieżki
odzyskiwania mogą jednocześnie uznać, że zwrot się należy, a wiersz i tak
powstanie jeden.

Kolejka BullMQ wykonuje decyzję u dostawcy, z ponowieniami i backoffem. Gdyby
Redis zniknął, wiersz Refund nadal mówi, że Guest ma pieniądze do odzyskania.

Kwota i waluta ze zdarzenia są porównywane z naszym snapshotem. Niezgodność nie
potwierdza rezerwacji — zleca zwrot. Lepiej oddać pieniądze niż potwierdzić
pobyt na podstawie kwoty, której nie umiemy wytłumaczyć.

### Nieudana płatność

Odrzucona karta nie jest utraconym terminem. `Payment → FAILED`, ale Booking
zostaje `PENDING_PAYMENT` tak długo, jak żyje Hold, i Guest może spróbować
ponownie. Po wygaśnięciu Holdu ponowienie jest niemożliwe — inaczej pobieralibyśmy
pieniądze za termin, który ktoś inny mógł już zająć.

### Fundament Connect

`host_payment_accounts` trzyma tyle, ile trzeba, żeby wiedzieć, czy Host może
przyjmować płatności:

```text
NOT_STARTED → IN_PROGRESS → READY | RESTRICTED
```

Onboarding prowadzi dostawca na własnych stronach. Rezervio nie zbiera dokumentów
tożsamości ani numerów kont — nie budujemy własnego KYC. Odwzorowanie całego
obiektu konta dostawcy w naszej schemie zrobiłoby z jego modelu nasz model.

### Granica na Settlement/Payout

```text
Payment: Guest    → Rezervio     (jest)
Payout:  Rezervio → Host         (Milestone 10)
```

Udany Payment **nie** znaczy, że Host dostał pieniądze. Prowizja jest
snapshotowana na płatności (`platform_fee_amount_minor`), żeby późniejsza zmiana
stawki nie przepisała historii — ale salda, transferów ani wypłat celowo tu nie
ma. Pół systemu wypłat jest gorsze niż żaden.

## Pobyt: informacje, dostęp i cykl życia

> **Host konfiguruje raz, Rezervio dostarcza we właściwym momencie.**

Gość nie klika „przyjechałem" ani „wyjechałem". Wszystko, co da się wyliczyć
z dat i zegara, jest wyliczane.

### StayInformation należy do Property

Instrukcje wejścia, parking, Wi-Fi i zasady domu są konfiguracją **obiektu**,
nie kopią w każdej rezerwacji. Gdyby były snapshotowane przy tworzeniu Booking,
Host poprawiający błędny opis drzwi poprawiałby go tylko dla przyszłych gości —
a ten, który przyjeżdża jutro, nadal stałby przed złymi drzwiami.

Publicznie widać z tego wyłącznie godziny zameldowania i zasady domu. Reszta
wymaga dostępu do konkretnej rezerwacji.

### Szyfrowanie i ujawnianie danych dostępu

Kod do drzwi w zrzucie bazy jest kodem do drzwi w cudzych rękach, więc
`property_sensitive_access` trzyma szyfrogram AES-256-GCM. Wspólny
`AeadCipher` obsługuje też URL-e iCal; klucze są osobne, żeby dało się je
rotować niezależnie.

O tym, czy gość widzi sekret, decyduje **backend**:

```text
effectiveRevealAt = manualRevealAt ?? checkInAt - revealOffsetHours
```

Przed tym momentem odpowiedź nie zawiera **żadnego fragmentu** sekretu — ani
zamaskowanego kodu, ani jego długości. Front, który zapomniałby coś ukryć, nie
miałby czego ujawnić.

`manualRevealAt` jest kolumną na `bookings`, nie zmianą ustawienia Property.
Gospodarz udostępniający dane jednemu gościowi wcześniej nie przesuwa terminu
wszystkim pozostałym. Operacja jest idempotentna dzięki `WHERE ... IS NULL`:
drugie kliknięcie nic nie zmienia i nie wysyła drugiego maila.

Sekret nigdy nie trafia do emaila. Wiadomość mówi tylko, że dane są dostępne
w Rezervio — poczty nie kontrolujemy po wysłaniu.

### Harmonogram w strefie obiektu

„24 godziny przed zameldowaniem" znaczy to samo dla gospodarza w Madrycie
i w Auckland, bo godziny są lokalnym czasem zegarowym interpretowanym
w `Property.timeZone`:

```text
check-in: 2026-09-12 15:00 Europe/Madrid
offset:   24h
wysyłka:  2026-09-11 15:00 Europe/Madrid
```

Konwersję robi `domain/stay.ts` na bazie `Intl`, dwuprzebiegowo — drugi przebieg
poprawia offset, gdy pierwszy wylądował po drugiej stronie zmiany czasu. Nie
wozimy własnej kopii bazy stref: dwie kopie zawsze w końcu się rozjadą.

### Zadania cyklu pobytu

Po `CONFIRMED` kolejka `stay-lifecycle` dostaje cztery zadania:

| Zadanie | Kiedy |
| --- | --- |
| `stay-instructions-ready` | `checkInAt - instructionsSendOffsetHours` |
| `sensitive-access-ready` | `checkInAt - revealOffsetHours` |
| `stay-checkout-reminder` | 24 h przed `checkOutAt` |
| `booking-complete` | `checkOutAt` |

Identyfikator zadania jest wyprowadzony z rezerwacji, więc zmiana godziny
zameldowania albo offsetu **zastępuje** stary wpis zamiast dokładać drugi.
Każde zadanie przeładowuje stan z PostgreSQL i sprawdza własny warunek — spóźnione,
podwójne albo dotyczące anulowanej rezerwacji nie robi nic.

`CONFIRMED → COMPLETED` dzieje się samo, po `checkOutAt` w strefie obiektu.
Okresowy sweep domyka rezerwacje, których zadanie zginęło przy czyszczeniu Redisa
— to jedyny przypadek, w którym utracone zadanie zostawiłoby złe **dane**,
a nie tylko niewysłane przypomnienie.

### Rozmowa wewnątrz rezerwacji

Jedna `Conversation` na Booking i żadnej innej. Bez rezerwacji nie ma o czym
rozmawiać i nikt nie jest uprawniony — dlatego nie ma globalnego messengera
User↔User.

Autoryzacja jest ta sama, co dla samej rezerwacji: konto, do którego Booking
należy, albo ważny Guest access token. Host czyta i pisze wyłącznie w rezerwacjach
swoich obiektów.

Paginacja jest kursorowa po `(created_at, id)`. Sam znacznik czasu by nie
wystarczył: dwie wiadomości z tej samej milisekundy byłyby dla kursora
nierozróżnialne i jedna wypadłaby między stronami.

Powiadomienie o wiadomości powstaje w **tej samej transakcji**, co wiadomość.
Awaria SMTP nie może zgubić czyjejś wiadomości, a zapisana wiadomość nie może po
cichu nie powiadomić drugiej strony. Klucz deduplikacji jest per wiadomość
(`booking-message:{messageId}:{host|guest}`), a nie per rezerwacja — każda
wiadomość zasługuje na swój email, i tylko jeden.

### Polling zamiast WebSocketów

Dwie osoby wymieniające kilka wiadomości wokół jednego pobytu nie potrzebują
gniazda na widza. Rozmowa odświeża się co kilka sekund i przy powrocie do karty.
To prostsze i odporniejsze: nie ma połączenia, które mogłoby cicho paść.

## Rozliczenia z gospodarzem

> **Udana płatność gościa nie oznacza, że gospodarz dostał pieniądze.**

Cztery rzeczy, których nigdy nie mylimy:

```text
Payment     Guest              → Rezervio
Settlement  ile należy się Hostowi i od kiedy
Transfer    saldo platformy    → Connected Account Hosta
Payout      Connected Account  → bank Hosta
```

Pełna droga pieniędzy:

```text
Payment SUCCEEDED → Settlement PENDING → releaseAt → AVAILABLE
                  → Transfer → TRANSFERRED → Payout → bank
```

### Snapshot, nie przeliczenie

Kwoty biorą się wyłącznie z niezmiennego snapshotu finansowego Booking i z
prowizji zapisanej na płatności. Gdyby Settlement przeliczał starą rezerwację
aktualną stawką, zmiana cennika po cichu przepisywałaby to, co obiecano
gospodarzowi. Baza pilnuje arytmetyki:

```sql
host_amount_minor + platform_fee_minor = gross_amount_minor
```

### Polityka zwolnienia

```text
releaseAt = check-in (w Property.timeZone) + HOST_SETTLEMENT_RELEASE_DELAY_HOURS
```

Domyślnie 24 h po zameldowaniu — konfiguracja, nie stała w domenie: marketplace
zmieniający apetyt na ryzyko nie powinien potrzebować wdrożenia, a testy
potrzebują zera.

Zapisujemy wyliczony instant. Kolejka **nie jest** źródłem prawdy: zadanie
release tylko pyta wiersz, czy jego własne `release_at` już minęło, więc
zadanie utracone przy czyszczeniu Redisa kosztuje opóźnienie, nigdy zły wynik.

### Separate Charges and Transfers

Gość płaci platformie, a gospodarz dostaje pieniądze później — kiedy pobyt
naprawdę na nie zarobił. To ten sam model, który zaczął się w milestone 08:
`PaymentIntent` idzie na konto platformy, a `Transfer` na konto gospodarza jest
osobną, świadomą decyzją.

Konsekwencja, o której łatwo zapomnieć: **zwrot obciążenia nie cofa Transfer**.
Po wypłacie pieniądze są już u gospodarza i trzeba je odzyskać osobno.

### Jeden przelew, nigdy dwa

Trzy zabezpieczenia, każde na innym poziomie:

| Poziom | Mechanizm |
| --- | --- |
| Baza | częściowy unikalny indeks: jeden żywy Transfer na Settlement |
| Aplikacja | przejęciem jest przejście wiersza w `PROCESSING`; przegrany nie dzwoni do dostawcy |
| Dostawca | stabilny klucz idempotency `settlement-transfer:{transferId}` |

Blokada jest na **wierszu Settlement**, nie na advisory locku Property.
Ten drugi pilnuje inventory — to zupełnie inne pytanie.

Wywołanie dostawcy dzieje się poza transakcją: round trip w otwartej transakcji
trzymałby blokadę wiersza przez czas sieci, a timeout wycofałby zapis o
przelewie, który naprawdę się wykonał.

### Gospodarz bez gotowego konta

Jeśli konto Connect nie jest `READY`, Settlement **zostaje** `AVAILABLE`.
To nie jest błąd ani utrata pieniędzy — gospodarz widzi „Dokończ konfigurację
płatności, aby otrzymać środki", a rekoncyliacja spróbuje ponownie, gdy konto
będzie gotowe.

### Zwrot przed i po przelewie

| Kiedy | Co się dzieje |
| --- | --- |
| przed Transfer | Settlement → `CANCELLED`, żaden przelew nie powstaje |
| po Transfer | `REVERSAL_PENDING` → dokładnie jeden `TransferReversal` → `REVERSED` |

„Dokładnie jeden" jest gwarancją bazy: unikalny indeks na
`(transfer_id, reason)`. Dwie ścieżki odzyskiwania mogą jednocześnie uznać, że
cofnięcie się należy, a wiersz powstanie jeden.

Rozliczanie zwrotów częściowych jest świadomie poza zakresem — zwrot mniejszy
niż całość płatności nie rusza Settlement.

### Payout jest obserwowany, nie inicjowany

Konto Express na domyślnym harmonogramie wypłaca się samo. Wymuszanie wypłaty
z poziomu platformy byłoby obchodzeniem dostawcy, a nie pracą z nim — więc
`host_payouts` to rejestr obserwacji: z webhooka i z okresowego odpytania.
Gospodarz widzi, gdzie są jego pieniądze, łącznie z nieudaną wypłatą.

### Rekoncyliacja

Webhook nie jest jedynym mechanizmem odzyskiwania. Zadanie
`financial-reconciliation` chodzi w ograniczonych partiach i:

```text
zwalnia Settlementy, których termin minął
pyta dostawcę o przelewy zawieszone w PROCESSING
ponawia przelewy dla Settlementów wciąż czekających
ponawia nieudane cofnięcia
odczytuje wypłaty
```

Rozbieżność, której nie umie wyjaśnić, zostaje **widoczna** — nic nie jest
zgadywane.

### Salda jako projekcja

Nie ma kolumny `host_balance`. Salda są sumowane z Settlementów przy każdym
odczycie:

```text
Pending     = SUM(host_amount) WHERE status = PENDING
Available   = SUM(host_amount) WHERE status IN (AVAILABLE, TRANSFER_PENDING, FAILED)
Transferred = SUM(host_amount) WHERE status = TRANSFERRED
```

Przechowywane saldo jest drugim źródłem prawdy i rozjeżdża się przy pierwszej
przegapionej aktualizacji.

### Tylko sandbox

Cały milestone da się przejść na kluczach testowych. Skrót
`[ Zwolnij środki teraz — sandbox ]` pomija **wyłącznie** czekanie na zegar:
używa tej samej komendy i tych samych warunków, a poza środowiskiem testowym
jest niedostępny.

## Admin i support

> **Support diagnozuje i ponawia. Nie ustawia stanów.**

To najważniejsza granica całego panelu. Narzędzie, którym da się wprowadzić bazę
w stan nieosiągalny dla domeny, jest narzędziem do tworzenia awarii, nie do ich
usuwania.

```text
wolno:   ponów powiadomienie, ponów zwrot, ponów przelew, resync iCal,
         odśwież konto Connect, uruchom rekoncyliację, ponów zadanie
nie wolno: Payment = SUCCEEDED, Settlement = TRANSFERRED, Payout = PAID,
         edycja salda gospodarza, potwierdzenie rezerwacji „ręcznie"
```

Każda akcja wywołuje **istniejącą komendę domenową** — tę samą, którą wykonuje
zadanie w tle. Dzięki temu wszystkie niezmienniki obowiązują tak samo: ponowione
powiadomienie nadal zajmuje wiersz `dedup_key`, ponowiony przelew nadal mieści
się w częściowym unikalnym indeksie, a klucz idempotency u dostawcy wciąż
pochodzi z naszego identyfikatora.

### Rola, nie osobne konto

`users.roles` to tablica z dwuelementowym słownikiem (`SUPPORT`, `ADMIN`). Support
loguje się tą samą sesją, co wszyscy — rola jedynie poszerza to, co ta sesja może
odczytać. Osobny system kont administracyjnych byłby drugim systemem auth do
utrzymania i drugim miejscem, w którym można się pomylić.

Roli **nie nadaje żadne API**. Robi to skrypt uruchamiany przy bazie:

```bash
pnpm admin:grant ada@example.com ADMIN
```

Endpoint, który potrafi wypromować konto do ADMIN, jest endpointem wartym ataku.
Pierwszy administrator i tak musi powstać poza aplikacją.

### Autoryzacja po stronie serwera

`AdminGuard` chroni **każdą** trasę `/api/admin/*`, także te, do których UI nie
prowadzi linku. Ukrycie linku nie jest kontrolą dostępu. Odmowa jest identyczna
dla gościa i dla gospodarza (`403 ADMIN_FORBIDDEN`) — inaczej odpowiedź stałaby
się sposobem na ustalenie, kto jest w zespole wsparcia.

Frontend nie decyduje o niczym: layout `/admin` pyta API o tryb Stripe i traktuje
`403` jako odpowiedź. Jeden strażnik, po stronie serwera.

### Czego panel nie pokazuje

```text
password hash
token sesji (nawet skrócony)
kod do drzwi, hasło Wi-Fi
surowy payload dostawcy
pełny adres email w listach
```

Adresy są maskowane (`a***@example.com`) wszędzie poza ekranem jednego konta:
support ma **rozpoznać** adres, nie czytać cudzej skrzynki. Przy obiekcie widać
wyłącznie, **czy** gospodarz skonfigurował dane dostępu — szyfrogram zostaje
szyfrogramem.

### Problemy operacyjne to zapytanie, nie tabela

Lista incydentów utrzymywana ręcznie rozjeżdża się w chwili, w której ktoś naprawi
przyczynę i zapomni zamknąć wpis. Wszystkie kategorie — `PAYMENT`, `REFUND`,
`SETTLEMENT`, `TRANSFER`, `PAYOUT`, `ICAL`, `NOTIFICATION`, `JOB`, `WEBHOOK` —
są liczone z tych samych tabel, które zapisuje domena. Problem znika dokładnie
wtedy, gdy znika jego przyczyna.

Każdy problem przynosi ze sobą listę bezpiecznych akcji. Pochodzi z backendu, więc
panel nie potrafi zaproponować czegoś, co API by odrzuciło.

Przykład reguły, która musi rozróżniać dwa podobne stany:

```text
Payment SUCCEEDED + Booking nie CONFIRMED + brak Refund   → problem
Payment SUCCEEDED + Booking EXPIRED       + jest Refund   → poprawny wynik wyścigu
```

### Audyt

`admin_actions` zapisuje wiersz **przed** wykonaniem pracy, więc akcja, która
wywróci proces, i tak zostawia ślad, że ktoś o nią poprosił. Metadane są
przepuszczane przez ten sam redaktor, co logi — ta tabela nie może stać się
jedynym miejscem, w którym wylądował sekret dostawcy.

Nieudane akcje są audytowane tak samo jak udane, z kodem zamiast komunikatu
dostawcy. `PAYMENT_PROVIDER_ERROR:resource_missing` mówi, że operacja zrobiła
dokładnie to, o co ją poproszono, a dostawca odmówił — `UNEXPECTED` w tym miejscu
byłoby nieprawdą.

### Rejestr zadań

Wszystkie kolejki BullMQ w jednym miejscu, razem z liczbą zadań, które wyczerpały
ponowienia. Bez tego zadanie po ostatniej próbie jest niewidoczne: leży w zbiorze
`failed`, do którego nikt nie zagląda, a email albo przelew, który reprezentowało,
po prostu się nie dzieje.

Niedostępny Redis jest **pokazany**, nie ukryty — kolejka bez odpowiedzi to
informacja, a nie powód, żeby cała strona przestała działać.

### Dedup zadania kontra ponowienie

BullMQ traktuje `add` ze znanym `jobId` jak brak operacji. To właśnie sprawia, że
zwykłe zakolejkowanie jest bezpieczne przy powtórzeniu — i to samo sprawiłoby, że
świadome ponowienie nie zrobiłoby nic.

```text
zadanie waiting / delayed / active → to samo już nadchodzi, nie dokładamy drugiego
zadanie completed / failed         → identyfikator zwolniony, ponowienie działa
```

Panel mówi, który przypadek zaszedł. „Nic się nie stało" i „już jest w drodze"
wyglądają dla operatora identycznie, jeśli nikt ich nie rozróżni.

## Observability

### Correlation ID

Każde żądanie dostaje `requestId` — z nagłówka `x-request-id`, jeśli klient go
przysłał, więc ślad zaczęty w Next.js nie rozpada się na dwie połowy przy wejściu
do API. Ten sam identyfikator wraca w nagłówku odpowiedzi i trafia do **każdej**
linii logu przez `AsyncLocalStorage`, także tej pisanej głęboko w serwisie.

Po rozwiązaniu sesji do kontekstu dopisywany jest `userId`. Dalej, gdzie ma to
sens: `bookingId`, `bookingReference`, `hostId`, `propertyId`, `paymentId`,
`settlementId`, `transferId`, `payoutId`, `refundId`, `jobId`, `providerEventId`.

### Redakcja

Jedna lista, czytana w dwóch miejscach — przez redakcję pino i przez serializer
adresów. Dwie kopie zawsze zaczęłyby się różnić dokładnie wtedy, gdy to ważne.

```text
Authorization, Cookie, Set-Cookie, stripe-signature
password, accessCode, wifiPassword, clientSecret, webhook secret
token eksportu iCal w ścieżce URL
fraza wyszukiwania (nazwisko albo email gościa)
```

Poza nazwami kluczy wycinane są też **wartości wyglądające na sekret**
(`sk_…`, `rk_…`, `whsec_…`, `pi_…_secret_…`) — bo sekret wstawiony w komunikat
błędu jest dokładnie tym przypadkiem, którego filtr po nazwach nie łapie.

### Liveness kontra readiness

```text
GET /api/health   proces żyje                   — nie dotyka żadnej zależności
GET /api/ready    PostgreSQL + Redis odpowiadają — 503, gdy któraś nie
```

Rozróżnienie ma konsekwencje operacyjne: liveness restartuje proces, readiness
wyjmuje instancję z ruchu. Gdyby `/health` odpytywał bazę, chwilowa awaria bazy
zamieniłaby się w restart wszystkich instancji naraz — najgorsza możliwa reakcja.

Żaden health check nie dzwoni do Stripe ani po feed iCal. Sprawdzanie cudzej
usługi na każdą sondę zamienia jej awarię w naszą i płaci za to przy każdym
zapytaniu.

Odpowiedź niosą **kody sterowników**, nigdy ich komunikaty: nieudane połączenie
z PostgreSQL wypisuje w swoim komunikacie cały DSN razem z hasłem, a endpoint
gotowości bywa najsłabiej chronioną rzeczą w całym wdrożeniu.

### Taksonomia błędów

Kod jest obietnicą dla klienta, że warunek jest stabilny i da się na nim
rozgałęzić; samo HTTP nie odróżnia „gospodarz nie dokończył onboardingu" od
„rozliczenie jeszcze nie dojrzało", a polskie zdanie nie jest czymś, na czym
frontend powinien robić `if`.

```text
ADMIN_FORBIDDEN                 RATE_LIMITED               INVALID_ORIGIN
PAYMENT_PROVIDER_ERROR          PAYMENT_INTEGRITY_ERROR    REFUND_FAILED
SETTLEMENT_NOT_READY            HOST_PAYMENT_ACCOUNT_NOT_READY
TRANSFER_FAILED                 ICAL_SYNC_FAILED           JOB_NOT_RETRYABLE
```

Odmowa dostawcy dostaje `502`, nie `500`: żądanie było poprawne, a Rezervio
zdrowe — odmówiła zależność. To rozróżnienie trzyma cudzą awarię poza naszym
budżetem błędów.

Stare błędy nie były migrowane. Ujednolicanie całej aplikacji tylko dla samego
ujednolicenia kosztowałoby więcej, niż daje.

## Hardening

### Środowisko sprawdzane przy starcie

```text
development   test   staging   production
```

Cztery nazwy, nie dwie: staging chce produkcyjnych reguł cookies i CORS, wciąż
działając na sandboxie Stripe, a testy chcą móc sprawdzić zachowanie
„produkcyjne" bez ustawiania `NODE_ENV=production`. Nierozpoznana nazwa to
development — nieznana wartość nigdy nie może po cichu przyznać produkcyjnych
ulg.

Brakujący sekret znaleziony przez pierwsze żądanie, które go potrzebuje, to
incydent. Ten sam sekret znaleziony przy starcie to nieudany deploy. Różnica w
koszcie jest ogromna.

### Guard na klucz live

```text
klucz sk_live_… / rk_live_…  →  proces nie startuje
```

W **każdym** środowisku, produkcji nie wyłączając. Milestone 11 nie jest decyzją
o przejściu na żywe płatności, a dopóki taka decyzja nie zapadnie, klucz live
w konfiguracji jest pomyłką — i to pomyłką, która obciąża prawdziwe karty.

### Cookies

```text
HttpOnly  zawsze          — frontend nie czyta tokenu, pyta /api/auth/me
Secure    production-like — na HTTP localhost przeglądarka po cichu porzuca cookie
SameSite  Lax
```

`Lax`, nie `Strict`: link dostępowy gościa przychodzi mailem, a `Strict`
odmówiłby wysłania cookie przy tej pierwszej nawigacji z zewnątrz — gość
wylądowałby na własnej rezerwacji z prośbą o zalogowanie. `Lax` i tak nie wysyła
cookie przy żadnym cross-site POST, czyli dokładnie tam, gdzie żyje CSRF.

### Origin

Druga warstwa nad `SameSite`, dla przeglądarki, która się pomyli, i na dzień,
w którym jakiś przepływ będzie potrzebował `SameSite=None`.

```text
sprawdzamy   state-changing + cookie Rezervio
przepuszczamy brak Origin (klient nie-przeglądarkowy — nie jest wektorem CSRF)
odrzucamy    Origin spoza allowlisty albo sec-fetch-site: cross-site
```

Webhook dostawcy przychodzi **bez** cookie i bez `Origin`; autoryzuje go podpis
nad surowym ciałem. Odrzucenie go tutaj gubiłoby zdarzenia płatnicze — jedyną
awarię, na którą ten system nie może sobie pozwolić.

### Rate limiting

Liczniki w Redisie, bo API jest bezstanowe i ma chodzić w wielu instancjach —
licznik w pamięci procesu mnożyłby każdy limit przez liczbę podów, czyli
znaczyłby tyle, co brak limitu.

Limiter **fail-open**: awaria Redisa nie może zamienić się w niedostępność
aplikacji.

| Bucket | Klucz | Dlaczego tak |
| --- | --- | --- |
| `login` | adres IP | zgrubny sufit nad limiterem per konto |
| `register` | adres IP | jedyny sygnał, jaki ma anonimowy endpoint |
| `guest-access` | numer rezerwacji + IP | jeden gość nie zjada budżetu całego NAT-u |
| `payment-create` | numer rezerwacji | ponowienie odrzuconej karty jest normalne |
| `message-send` | konto albo rezerwacja | |
| `admin-search` | konto operatora | zapytanie dotyka dziewięciu tabel |
| `admin-action` | konto operatora | |

Wszystko, co robi zalogowany, jest kluczowane **po nim**, nie po adresie.

Osobno, w pamięci procesu, siedzi ochrona przed brute-force logowania: dwa
wymiary, bo opisują dwa różne ataki i żaden nie łapie drugiego.

```text
per email  10 nieudanych prób / 15 min → cooldown
per IP     30 nieudanych prób / 15 min → cooldown
```

Liczone są **wyłącznie porażki** — karanie wspólnego adresu za udane logowania
nie ma sensu. Odpowiedź w cooldownie jest co do bajtu tą samą odpowiedzią, co
złe hasło: inaczej stałaby się sposobem na sprawdzenie, które adresy istnieją.

### Nagłówki

API i aplikacja webowa mają **osobne** polityki, bo serwują co innego. CSP API
pilnuje jednej strony HTML, którą wystawia — Swagger UI. CSP, które ma znaczenie
dla płatności, jest w `next.config.ts`:

```text
script-src   https://js.stripe.com
frame-src    https://js.stripe.com https://hooks.stripe.com
connect-src  https://api.stripe.com + origin API
worker-src   blob:   (renderer mapy)
```

Polityka, która zapomni któregokolwiek z pierwszych trzech, daje pole karty,
które po prostu się nie pojawia — i żadnego błędu, który ktoś by zobaczył.
Dlatego są wypisane wprost i przykryte testem.

HSTS wyłącznie w produkcji. Wysłany po zwykłym HTTP uczy przeglądarkę odmawiać
localhost przez pół roku — awaria na każdej maszynie deweloperskiej naraz.

### Wejście do SQL

Admin search dotyka dziewięciu tabel i przyjmuje dowolny tekst od operatora.
Żadna gałąź nie wkleja terminu do SQL: `%` do dopasowań rozmytych jest
**wartością wiązaną**, więc termin pełen apostrofów to termin, który nic nie
znajduje, a nie termin, który się wykonuje.

## Ograniczenie: Stripe wyłącznie w sandboxie

```text
Stripe = test / sandbox
```

Nie ma przełącznika test → live, nie ma UI do przechowywania kluczy live, nie ma
ścieżki migracji. Klucz live zatrzymuje start procesu, więc tryb `LIVE` nie może
pojawić się w działającej aplikacji — a panel admina nosi widoczny badge
**STRIPE TEST MODE** na każdej stronie, żeby nikt nie pomylił przelewu
w sandboxie z pieniędzmi, które naprawdę się poruszyły.

## Connectivity z zewnętrznym PMS i channel managerem

> **Rezervio pozostaje source of truth dla Booking i ostatecznej dostępności.**
> Zewnętrzny system dostarcza sygnały, nie decyzje.

Cel jest jeden: Rezervio ma być dodatkowym kanałem sprzedaży, a nie dodatkowym
kalendarzem do ręcznego przepisywania.

### Dwie relacje, nie dwa warianty jednej

To najważniejsze rozróżnienie całego etapu i powód, dla którego nie ma tu
jednego „provider interface".

```text
HOSTAWAY   Rezervio → PMS          jesteśmy klientem, trzymamy cudze klucze
CHANNEX    Channel manager → Rezervio   jesteśmy kanałem, wystawiamy endpointy
```

Przy PMS pytamy: `listListings`, `listReservations`, `createReservation`,
`cancelReservation`. Przy channel managerze **większość integracji to mały
serwer**, który ktoś inny odpytuje — `test_connection`, `mapping_details`,
`changes` — a na zewnątrz idzie tylko dostarczenie rezerwacji.

Wciśnięcie obu w jeden interfejs dałoby metody, które po jednej stronie nie
znaczą nic. `ProviderRegistry.inventoryProvider('CHANNEX')` zwraca `null`
i to jest odpowiedź, a nie brak implementacji.

### Model

```text
ExternalInventoryConnection   Host ↔ dostawca, dane dostępowe, stan
ExternalPropertyMapping       Property ↔ listing, zatwierdzone przez Hosta
ExternalReservationMapping    rezerwacja tam ↔ rezerwacja tutaj, INBOUND/OUTBOUND
ExternalProviderEvent         co przyszło, raz
ExternalSyncAttempt           co zrobiła każda synchronizacja
```

### Projekcja, nie Booking

Rezerwacja z zewnętrznego systemu **nie staje się** Bookingiem Rezervio. Nie ma
gościa Rezervio, ceny, którą ustaliliśmy, ani płatności, którą pobraliśmy —
tworzenie Bookingu wymyślałoby wszystkie trzy naraz.

```text
external reservation
      ↓
ExternalReservationMapping (INBOUND)
      ↓
AvailabilityBlock(EXTERNAL_PROVIDER)
```

Blokada wisi na mapowaniu, a nie na feedzie: rezerwacja ma tożsamość, więc ta
sama dostawa dwa razy aktualizuje jeden wiersz zamiast dokładać drugi, a
anulowanie zwalnia dokładnie te noce, które zajmowało.

### Ten sam lock, co wszystko inne

Każdy zapis dostępności pochodzący od dostawcy bierze **ten sam
`pg_advisory_xact_lock` na Property**, co tworzenie Bookingu, wygasanie Holdu,
rekoncyliacja iCal i ręczna blokada gospodarza. Nie ma drugiej ścieżki do
`availability_blocks`.

Wyścig, który musi być bezpieczny:

```text
rezerwacja zewnętrzna pierwsza  →  Booking odrzucony, PROPERTY_NOT_AVAILABLE
Booking (albo żywy Hold) pierwszy →  rezerwacja zapisana i oznaczona jako konflikt
```

Trzeciej możliwości — obie strony po cichu wygrywają — nie ma. Konflikt jest
**pokazywany**, nie wchłaniany: te same noce sprzedane w dwóch systemach to
fakt, którego blokowanie nie naprawia, i ktoś musi zdecydować.

### Idempotencja

Trzy niezależne gwarancje bazodanowe, każda na innym poziomie:

| Co | Mechanizm |
| --- | --- |
| Powtórzony webhook / poll | unikalne `(connection, external_reservation_id)` |
| Druga blokada z tej samej rezerwacji | unikalne `availability_blocks.external_reservation_mapping_id` |
| Ponowione przekazanie Bookingu | częściowy unikalny indeks `(connection, booking_id)` dla `OUTBOUND` |

Ostatnia działa tak samo, jak przy przelewach do gospodarza: **najpierw
zajmujemy wiersz, potem dzwonimy do dostawcy.** Dwóch workerów, którzy trafią
tam w tej samej milisekundzie, produkuje jeden wiersz i jedno wywołanie.

### Webhook plus polling

```text
webhook   szybka ścieżka — zwykle sekundy
polling   ścieżka odzyskiwania — dla powiadomienia, które nie dotarło
```

Żadnej z nich nie ufamy samej. Webhook bywa zgubiony, opóźniony albo dostarczony
nie po kolei; okresowy sweep jest tym, co sprawia, że „kalendarz w końcu jest
poprawny" jest prawdą mimo to.

Zdarzenie niesie **identyfikator, nie stan**: rezerwację doczytujemy od
dostawcy zamiast wierzyć payloadowi. Hostaway wprost pisze, że zdarzenia mogą
przyjść nie po kolei, więc payload bywa nieaktualny w chwili przetwarzania.

Zdarzenie jest przyjmowane i przetwarzane asynchronicznie — Hostaway daje na
potwierdzenie dwadzieścia sekund, a zastosowanie zdarzenia oznacza kolejne
wywołanie do Hostaway.

### Uwierzytelnienie webhooka bez podpisu

Hostaway **nie podpisuje** webhooków. Jego kontrakt przewiduje login i hasło,
które przekaże w nagłówku `Authorization` — i tyle. Więc tyle sprawdzamy, na
sekrecie, który generuje Rezervio, a nie wybiera Host. Wymyślanie tu schematu
podpisu byłoby wymyślaniem kontraktu, którego dostawca nie ma.

Identyfikator połączenia jest w ścieżce, a nie w ciele: ciało jest
nieuwierzytelnione, dopóki nagłówek nie zostanie sprawdzony. Nieznane
połączenie i złe hasło odpowiadają identycznie.

### Awaria dostawcy nie cofa rezerwacji

```text
Booking = CONFIRMED, push nieudany
      ↓
Booking zostaje CONFIRMED
issue = OUTBOUND_SYNC_FAILED
retry z backoffem
widoczne dla Hosta i dla wsparcia
```

Gość zapłacił, pobyt jest potwierdzony, a channel manager mający gorsze
popołudnie nie jest powodem, żeby to odkręcać.

Intencja przekazania commituje się **w tej samej transakcji**, co potwierdzenie
rezerwacji — przez ten sam outbox, co powiadomienia. Dzięki temu „potwierdzone,
ale nikt na zewnątrz się nie dowiedział" nie może wyniknąć z awarii między
commitem a `queue.add()`. I odwrotnie: potwierdzenie rezerwacji nigdy nie czeka
na to, czy dostawca odpowiada.

### Channex: Rezervio jako kanał

Rezervio wystawia trzy endpointy z opublikowanego Open Channel API — wszystkie
uwierzytelnione nagłówkiem `api-key`:

```text
GET  /api/channels/channex/test_connection
GET  /api/channels/channex/mapping_details
POST /api/channels/channex/changes
```

Na zewnątrz idzie jedno wywołanie: dostarczenie rezerwacji (`status` niesie
`new` / `modified` / `cancelled` — osobnej ścieżki anulowania kontrakt nie ma).

Model Channexa jest hotelowy: room types, rate plans, obłożenie. Rezervio takie
nie jest — jeden `Property` to jedna niezależnie rezerwowalna jednostka, bez
pokoi i bez allotmentu. Mapowanie to zawsze **jeden room type z jednym rate
planem**, a `availability` wynosi 0 albo 1. To realne ograniczenie modelu, nie
uproszczenie implementacji.

Ceny z kanału są przyjmowane i **ignorowane** (`read_only: true`): cenę ustala
Host w Rezervio, a kanał, który mógłby ją przepisać, sprawiłby, że kwota
pokazana gościowi zależy od systemu, którego w Rezervio nikt nie widzi.

### Dostęp partnerski jako stan, nie jako błąd

Channex wymaga konta staging, zarejestrowanego Open Channel, hotel code
i przejścia certyfikacji. Dopóki ich nie ma:

```text
status = ACTION_REQUIRED
reason = PARTNER_ACCESS_REQUIRED
```

i każdy endpoint kanału odpowiada `503` z tym samym kodem. Kod jest poprawny,
onboarding się nie odbył — i tak to jest raportowane, zamiast udawać działającą
integrację.

### Bezpieczeństwo

- **Dane dostępowe szyfrowane** (AES-256-GCM, własny klucz), odszyfrowywane
  wyłącznie w adapterze tuż przed wywołaniem. Nie wracają przez API, nie ma ich
  w panelu admina — nawet zamaskowanych — i nie trafiają do logów.
- **Allowlista domen dostawcy.** Base URL pochodzi z konfiguracji, a konfiguracja
  bywa pod wpływem Hosta; podążanie za nią bez sprawdzenia byłoby SSRF-em
  z naszymi własnymi kluczami w nagłówku. Wyjątek dla loopbacka istnieje
  wyłącznie poza produkcją i służy testom kontraktowym.
- **Izolacja między Hostami.** Host A, który poda identyfikator połączenia Hosta
  B, dostaje `404` — nigdy `403`, bo `403` potwierdzałby, że połączenie istnieje.
  Mapowanie cudzego `Property` jest sprawdzane po stronie serwera, a nie
  w żądaniu.
- **Payload zdarzenia nie jest przechowywany** — tylko jego hash. To wystarczy,
  żeby zauważyć, że redostawa różni się od oryginału, bez trzymania cudzych
  danych gościa w tabeli diagnostycznej.

### Współistnienie z iCal

iCal zostaje. Ten sam obiekt może być podpięty natywnie **i** przez iCal — wtedy
ta sama rezerwacja przyjdzie dwa razy, raz jako anonimowa blokada, raz jako
rezerwacja z identyfikatorem. Rezervio **ostrzega** i niczego nie wyłącza za
Hosta. Blokady z obu źródeł mają osobne `source_type` i osobne cykle życia, więc
nigdy się nie mieszają.

## Lokalizacja Property i mapy

> **`Property.latitude` / `Property.longitude` są jedynym źródłem prawdy dla
> każdej mapy w Rezervio.** Nic nie wylicza punktu z nazwy miasta i nic go nie
> losuje.

Adres prowadzi do zapisanych współrzędnych, a wszystkie mapy — wyników,
szczegółów obiektu i edytora gospodarza — czytają dokładnie te same liczby.

### Droga adresu do punktu

```text
Host wpisuje ulicę, kod, miasto, kraj
        ↓ debounce, po stronie serwera
GeocodingProvider
        ↓
lat/lon + precyzja
        ↓ mapa przesuwa się, znacznik ląduje w znalezionym miejscu
Host przeciąga znacznik, jeśli trafiliśmy obok
        ↓
Property.latitude / Property.longitude
```

Zarówno wynik geokodowania, jak i przeciągnięty znacznik zapisują się **tą samą
ścieżką**. Ręczna korekta nie jest gorszym źródłem — jest lepszym: gospodarz
stoi bliżej budynku niż jakikolwiek geokoder.

### GeocodingProvider

```ts
interface GeocodingProvider {
  geocode(address: GeocodeAddress): Promise<GeocodingResult | null>
}
```

Jeden interfejs, jeden adapter — **Nominatim** (OpenStreetMap). Nie ma tu
rejestru providerów, bo jest dokładnie jeden, a drugi będzie właściwym momentem
na uogólnienie.

Dlaczego Nominatim:

- nie wymaga konta, klucza ani relacji rozliczeniowej — jak reszta stosu na tym
  etapie;
- dzieli dane z podkładem, który już renderujemy (OpenFreeMap serwuje kafle
  OSM), więc punkt i kafel zgadzają się co do tego, gdzie jest ulica; para
  z różnych źródeł tego nie gwarantuje;
- kontrakt jest publiczny i stabilny.

Geokodowanie działa **po stronie serwera**, nie w przeglądarce. Polityka
Nominatima prosi o co najwyżej jedno żądanie na sekundę i User-Agent
identyfikujący aplikację; przeglądarki nie da się do tego zobowiązać, a adres
gospodarza nie opuszcza wtedy origin Rezervio.

Serwis dokłada dwie rzeczy, o które ta polityka prosi: **kolejkę** (jedno
wywołanie naraz, nie częściej niż raz na sekundę) i **cache** (ta sama
odpowiedź na to samo pytanie, bez pytania drugi raz).

Cache traktuje jednak znalezienie i brak wyniku inaczej. Znaleziony punkt żyje
dobę — ulice się nie przenoszą. Brak wyniku żyje **kilka sekund**, bo to nie
jest fakt o adresie, tylko o jednej odpowiedzi: Nominatim pod obciążeniem nie
zwraca błędu, zwraca pustą listę, a dane OSM się uzupełniają. Krótkie TTL
wystarcza, żeby wchłonąć serię zapytań z pisania w formularzu, i nie zamienia
jednej pustej odpowiedzi w całodobowe „tego adresu nie ma". Jawne „znajdź
z adresu" omija cache w całości — sens tego przycisku polega na niezgodzie
z poprzednią odpowiedzią.

### Precyzja jest częścią odpowiedzi

```text
EXACT    numer budynku
STREET   ulica
CITY     samo miasto
AREA     region
```

To dlatego wynik nie jest samą parą liczb. Punkt „gdzieś w Gdańsku" nie jest
lokalizacją obiektu i nie może zostać po cichu zapisany jako taka — gospodarz
dostaje wtedy wyraźne „trafiliśmy tylko w okolicę, przeciągnij znacznik".

### Czego nie zapiszemy

```text
NaN
0, 0            — Zatoka Gwinejska; tak wygląda odpowiedź, której nikt nie sparsował
poza zakresem   — |lat| > 90, |lon| > 180
połowa punktu   — szerokość bez długości
```

Sprawdzane przy zapisie Property, a nie tylko w formularzu: kolumnowe `CHECK`
przepuściłyby szerokość bez długości, zostawiając obiekt, który przechodzi
walidację publikacji i którego nie da się postawić na mapie.

### Kraj jest wybierany, nie wpisywany

Kod kraju wygląda na drobiazg, a jest warunkiem, żeby geokodowanie w ogóle
mogło się udać: dostawca filtruje wyniki po kraju, więc kod, którego nie ma,
nie daje błędu — daje pustą listę nie do odróżnienia od „nie znamy takiej
ulicy".

Dwuznakowe pole tekstowe zamieniało „Polska" w `PO` bez słowa. Obiekt zapisywał
się poprawnie, każde wyszukanie adresu wracało jako „nie znaleźliśmy", punkt na
mapie nie powstawał, a publikacja była blokowana przez `LOCATION` — cztery
objawy jednej przyczyny, żaden nie wskazujący na pole „kod kraju".

```text
edytor      lista krajów, nie pole dwuznakowe
API         @IsISO31661Alpha2 — kod ISO albo 400, dla każdego klienta
```

Walidacja stoi na granicy API, nie tylko w formularzu: edytor jest jednym
z klientów, a nie jedyną drogą do bazy.

### Kiedy pytamy geokoder

```text
debounce ~900 ms      nie żądanie na literę nazwy ulicy
adres bez zmian       nie pytamy ponownie — także po ponownym otwarciu edytora
wielkość liter, spacje  to nie jest zmiana adresu
obiekt ma już punkt   automatyczne wyszukanie go NIE nadpisuje
```

Ostatnia reguła jest najważniejsza: automatyczne geokodowanie **proponuje**
lokalizację obiektowi, który jej nie ma. Cofnąć ręczną korektę może wyłącznie
jawne „znajdź z adresu".

Reguła musi być jednak widoczna. Znaleziony punkt, który nie przesunął
znacznika, wygląda identycznie jak strona ignorująca wpisany adres, więc
edytor mówi to wprost — „znacznik został tam, gdzie był" — i proponuje
przeniesienie jednym kliknięciem. Brak wyniku i brak możliwości zapytania to
też dwie różne rzeczy: bez miasta i kraju nie ma o co pytać i tak właśnie jest
to napisane.

### Mapa wyników

Każdy znacznik pochodzi z pól tego samego Property, które renderuje kartę.
Marker i karta są kluczowane po `property.id` — stąd działa hover, zaznaczenie
i przewijanie do karty po kliknięciu w znacznik.

`fitBounds` obejmuje aktualne wyniki. `DEFAULT_CENTER` istnieje i jest
uprawnione: pusta mapa musi gdzieś patrzeć, zanim przyjdą pierwsze wyniki. Nie
zastępuje natomiast obiektu bez współrzędnych — taki obiekt **nie dostaje
znacznika**, bo pinezka mniej więcej we właściwym mieście wygląda jak
odpowiedź, a nią nie jest.

### Stan wyszukiwania

```text
1. URL query params     to, o co poproszono, albo link, który ktoś dostał
2. last search          poprzednie wyszukiwanie na tym urządzeniu
3. puste
```

URL zawsze wygrywa. Link mówiący „Kraków" musi pokazać Kraków także na
laptopie, którego ostatnie wyszukiwanie to Zakopane — inaczej linkom nie da się
ufać, a to kosztuje więcej, niż warta jest wygoda. `localStorage` wchodzi
wyłącznie przy gołym `/search`, i wtedy trafia do URL-a, stając się
wyszukiwaniem jak każde inne.

Pierwszy raz na stronie to **pusty formularz**. Nie ma domyślnego miasta ani
domyślnego terminu: pokazywały produkt jako żywy na zrzucie ekranu i kłamały
każdemu prawdziwemu gościowi.

Zapisujemy tylko wyszukiwanie, które coś mówi — sam zestaw filtrów nim nie
jest. Termin to obie daty albo żadna: jedna sama nie wycenia niczego i dociera
do kalendarza jako `Invalid Date`.

## PostgreSQL jako baza i jako search

> PostgreSQL jest obecnie zarówno source of truth, jak i search backendem MVP.

Jedno zapytanie SQL wykonuje filtrowanie, wycenę, sortowanie i zliczanie wyników.
Nic nie jest filtrowane w Node — inaczej indeksy nie miałyby znaczenia, a wyniki
zależałyby od tego, ile rekordów zdążono pobrać.

Wykorzystywane mechanizmy:

| Mechanizm | Zastosowanie | Indeks |
| --- | --- | --- |
| `geography(Point, 4326)` | viewport mapy, dystanse | GiST |
| `tsvector` (`simple`) | full-text po tytule, opisie, mieście, dzielnicy | GIN |
| `pg_trgm` | tolerancja na brak ogonków i literówki | GIN (`gin_trgm_ops`) |

Kolumny `location` i `search_document` są **generated** — pochodne od
`latitude`/`longitude` oraz pól tekstowych, więc nie mogą się z nimi rozjechać.

Konfiguracja FTS to `simple`, nie słownik językowy: opisy są wielojęzyczne, a
stemming angielski psułby polskie teksty. Za dopasowanie mimo odmiany i literówek
odpowiada warstwa trigramowa.

> Jeżeli search stanie się niezależnym problemem skalowania lub rankingu, może
> zostać później wydzielony do Vespa/OpenSearch bez zmiany transactional source
> of truth.

## pgvector

Rozszerzenie jest aktywne, ale **nie generujemy jeszcze embeddings** i nie ma
kolumny wektorowej — wybór wymiaru zależy od modelu, którego jeszcze nie ma.
Semantic search to osobny milestone.

## Pieniądze

Kwoty są przechowywane i zwracane jako `integer` w minor units razem z walutą
ISO-4217 (`192000` + `PLN` = 1 920,00 PLN). Nigdzie nie ma `float` dla pieniędzy.
Formatowanie do „1 920 zł" to wyłącznie warstwa prezentacji.

## Ranking RECOMMENDED

Jawny, deterministyczny wzór — łatwy do wytłumaczenia i do zmiany:

```text
rating * 10
+ (saving / marketAmount) * 120
+ min(reviewCount, 400) / 400 * 12
```

Bez ML, bez losowości. Ta sama baza zawsze daje tę samą kolejność.

## Granice, których pilnujemy

- **API DTO ≠ encja bazy** — schemat może się zmieniać bez łamania klientów.
- **Backend jest bezstanowy** — gotowy na wiele instancji.
- **Publiczne endpointy zwracają tylko `PUBLISHED` Property.**
- **Slug jest tożsamością routingową, `id` (UUID) tożsamością domenową.**
  Slug podąża za tytułem tylko do pierwszej publikacji; potem jest zamrożony,
  bo stabilny adres jest ważniejszy niż ładny.
- **Adres prywatny (`addressLine1`, `postalCode`) nie istnieje w publicznym
  DTO** — nie jest filtrowany na froncie, tylko nigdy nie opuszcza backendu.
- **DRAFT może być niekompletny** — dlatego `description`, `latitude`
  i `longitude` są nullable. Kompletności pilnuje walidacja publikacji, a nie
  definicja kolumny.
- **Availability liczy PostgreSQL, nie Node.** Redis trzyma zadania, nigdy
  odpowiedzi na pytanie o dostępność.
- **Nieudana synchronizacja nigdy nie kasuje poprzednich blokad.**
- **Email nigdy nie blokuje transakcji.** Powiadomienie jest zapisywane
  w outboxie razem ze zmianą stanu i wysyłane po commicie.
- **`publicReference` nie jest sekretem.** Dostęp gościa wymaga tokenu.
- **Konto nigdy nie jest wymagane do rezerwacji.** `guest_user_id` jest
  nullable, a Guest snapshot powstaje zawsze.
- **Booking nie jest linkowany po adresie email.** Przypisanie do konta wymaga
  jawnego, potrójnie zweryfikowanego claimu.
- **Każdy zapis zmieniający dostępność bierze advisory lock na Property**,
  a dostępność jest sprawdzana ponownie wewnątrz tej samej transakcji.
- **Cenę ustala serwer.** Kwota przysłana przez przeglądarkę jest ignorowana,
  a Booking trzyma snapshot — późniejsza zmiana stawki go nie rusza.
- **Pulpit i kalendarz gospodarza nie mają własnego stanu.** Są liczone
  z rezerwacji, obiektów i blokad przy każdym żądaniu.
- **Szybkie akcje na pulpicie nie omijają maszyny stanów.** Akceptacja
  i odrzucenie idą przez te same komendy, co lista rezerwacji.
- **Płatność potwierdza wyłącznie zweryfikowany webhook.** Komunikat
  z przeglądarki nie zmienia statusu rezerwacji.
- **Konwersja Hold → Booking jest jedną transakcją pod lockiem Property.**
  Blokada jest przepisywana w miejscu, nigdy kasowana i wstawiana ponownie.
- **Rezervio nigdy nie widzi danych karty.** Numer, CVC i data ważności są
  wpisywane w ramce dostawcy i nie przechodzą przez nasz backend.
- **Spóźniona płatność nie potwierdza wygasłej rezerwacji.** Wraca w całości,
  dokładnie raz.
- **O ujawnieniu danych dostępu decyduje backend.** Przed terminem odpowiedź nie
  zawiera żadnego fragmentu sekretu.
- **Ręczne udostępnienie dotyczy jednej rezerwacji.** Domyślny offset Property
  pozostaje nietknięty.
- **Gość nie melduje przyjazdu ani wyjazdu.** Faza pobytu jest wyliczana,
  a `COMPLETED` ustawia się samo.
- **Rozmowa istnieje tylko wewnątrz rezerwacji.** Nie ma messengera User↔User.
- **Awaria poczty nie cofa wiadomości.** Intencja powiadomienia commituje się
  razem z nią, wysyłka dzieje się później.
- **Kwota dla gospodarza pochodzi ze snapshotu rezerwacji.** Nigdy z żądania
  i nigdy przez przeliczenie starej rezerwacji aktualną prowizją.
- **Przelew do gospodarza nie dzieje się od razu po płatności.** Najpierw
  `releaseAt`, potem `AVAILABLE`, dopiero potem Transfer.
- **Jeden Settlement może mieć najwyżej jeden żywy Transfer.** Pilnuje tego
  częściowy unikalny indeks, nie kolejność zdarzeń.
- **Zwrot po przelewie wymaga cofnięcia przelewu.** Dokładnie jednego.
- **Saldo gospodarza nie jest przechowywane.** Jest liczone z rozliczeń.
- **Support ponawia, nie ustawia.** Nie istnieje endpoint, który zapisuje status
  domenowy — każda akcja administracyjna uruchamia istniejącą komendę.
- **Rola administracyjna nie pochodzi z API.** Nadaje ją skrypt przy bazie.
- **Każda trasa `/api/admin/*` jest chroniona po stronie serwera**, także ta,
  do której UI nie prowadzi linku.
- **Problemy operacyjne są zapytaniem, nie tabelą.** Znikają razem z przyczyną.
- **Panel nie pokazuje sekretu.** Ani hasha hasła, ani tokenu sesji, ani kodu do
  drzwi, ani surowego payloadu dostawcy.
- **Klucz live Stripe zatrzymuje start procesu** — w każdym środowisku.
- **Liveness nie dotyka zależności.** Awaria bazy nie może wywołać restartu
  wszystkich instancji.
- **Rate limiter zawodzi otwarcie.** Niedostępny Redis nie jest powodem do
  odrzucania ruchu.
- **Webhook dostawcy nigdy nie jest blokowany przez ochronę Origin.**
- **Rezervio jest source of truth dla Booking i ostatecznej dostępności.**
  Zewnętrzny system dostarcza sygnały, nigdy decyzje.
- **Rezerwacja zewnętrzna nie jest Bookingiem.** Jest projekcją: mapowanie plus
  blokada dostępności.
- **Każdy zapis dostępności od dostawcy bierze ten sam advisory lock Property**,
  co Booking, Hold, iCal i ręczna blokada.
- **Powtórzony webhook, poll i job nie tworzą drugiej blokady ani drugiej
  rezerwacji.** Pilnują tego trzy unikalne indeksy, nie kolejność zdarzeń.
- **Awaria dostawcy nie cofa potwierdzonej rezerwacji.** Zostaje retry
  i widoczny problem operacyjny.
- **Dane dostępowe dostawcy są szyfrowane** i nie opuszczają backendu w żadnej
  postaci — także nie w panelu admina.
- **PMS i channel manager to dwie różne relacje.** Nie mają wspólnego
  interfejsu, bo połowa metod nie znaczyłaby nic po jednej ze stron.
- **Brak dostępu partnerskiego jest stanem, nie błędem** — i nie jest
  raportowany jako działająca integracja.
- **`Property.latitude` / `longitude` są jedynym źródłem prawdy dla map.**
  Żadna mapa nie wylicza punktu z miasta i nie losuje offsetu.
- **Ręczna korekta znacznika ma pierwszeństwo przed geokoderem.** Automatyczne
  wyszukanie nie nadpisuje punktu, który obiekt już ma.
- **`0, 0`, NaN i połowa punktu nie są lokalizacją** i nie da się ich zapisać.
- **URL ma pierwszeństwo przed zapamiętanym wyszukiwaniem.** `localStorage`
  nigdy nie nadpisuje parametrów z adresu.
- **Pierwsze wejście to puste wyszukiwanie** — bez domyślnego miasta i bez
  domyślnych dat.

## Terminologia

Wiążący jest [język domenowy](./rezervio-domain-language.md): `Property`,
`Listing`, `Host`, `Guest`, `Stay`, `PriceQuote`, `Amenity`. Synonimy w rodzaju
`Offer`, `Accommodation` czy `Reservation` nie pojawiają się w kodzie.
