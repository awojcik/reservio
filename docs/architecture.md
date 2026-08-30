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

### Granica na przyszłe płatności

```text
PENDING_PAYMENT
      ↓ udana płatność (Milestone 05)
CONFIRMED
      ↓
AvailabilityBlock: BOOKING_HOLD → BOOKING   (transakcyjnie)
```

`CONFIRMED` jest dziś nieosiągalny — żadna komenda go nie ustawia.

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

## Terminologia

Wiążący jest [język domenowy](./rezervio-domain-language.md): `Property`,
`Listing`, `Host`, `Guest`, `Stay`, `PriceQuote`, `Amenity`. Synonimy w rodzaju
`Offer`, `Accommodation` czy `Reservation` nie pojawiają się w kodzie.
