# rezervio°

Marketplace noclegów, w którym **cena całkowita** jest widoczna od pierwszego ekranu.

> Hosts pay less. Guests pay less.

Next.js pobiera dane przez REST z NestJS, źródłem prawdy jest PostgreSQL —
z PostGIS, pełnotekstowym wyszukiwaniem, `pg_trgm` i `daterange` dla
dostępności — zdjęcia obiektów leżą w storage zgodnym z S3, a synchronizacja
kalendarzy chodzi przez Redis i BullMQ.

## Wymagania

- **Node.js 20.9+** (Next 16 i NestJS 11)
- **pnpm 9+**
- **Podman** — preferowany lokalny container runtime; Docker Desktop nie jest wymagany

Na macOS Podman działa przez maszynę wirtualną:

```bash
podman machine init    # tylko przy pierwszym uruchomieniu
podman machine start
podman info            # weryfikacja
```

## Uruchomienie

```bash
git clone https://github.com/awojcik/reservio.git
cd reservio

pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env

pnpm infra:start   # PostgreSQL + object storage + Redis + Mailpit (obrazy przy pierwszym starcie)
pnpm db:migrate
pnpm db:seed

pnpm dev           # web + api równolegle
```

| Co | Adres |
| --- | --- |
| Web | http://localhost:3000 |
| Konto i podróże | http://localhost:3000/account |
| Panel gospodarza | http://localhost:3000/host |
| Kalendarz wszystkich obiektów | http://localhost:3000/host/calendar |
| Rezerwacje gospodarza | http://localhost:3000/host/bookings |
| Płatności gospodarza | http://localhost:3000/host/payments |
| API | http://localhost:3001/api |
| Swagger | http://localhost:3001/api/docs |
| OpenAPI | http://localhost:3001/api/openapi.json |
| Object storage (S3) | http://localhost:9000 |
| Konsola storage | http://localhost:9001 |
| Redis (kolejka) | localhost:6379 |
| Skrzynka e-mail (Mailpit) | http://localhost:8025 |

### Konto demo

Seed zakłada gospodarza z katalogiem demo. **Wyłącznie do developmentu:**

```text
host@rezervio.local / rezervio-demo-2026
```

To konto ma profil gospodarza, więc widzi zarówno `/account`, jak i `/host`.
Zwykłe konto gościa założysz na `/register`.

## Konto i Moje podróże

Rezervio ma **jedno konto** dla obu ról:

```text
User
├── Moje podróże            (rezerwacje)
└── Profil gospodarza       (opcjonalny)
    └── Panel gospodarza
```

Ta sama osoba rezerwuje cudze obiekty i wystawia własne — bez drugiego konta
i bez przełączania sesji.

| Trasa | Co robi |
| --- | --- |
| `/register` | zakłada konto (sam `User`) |
| `/login` | wspólne logowanie |
| `/account` | pulpit: nadchodzące podróże, oczekujące prośby |
| `/account/trips` | wszystkie rezerwacje, z filtrami |
| `/account/profile` | imię, nazwisko, telefon, język |
| `/host/register` | zakłada konto **razem** z profilem gospodarza |

Konto z profilem gospodarza widzi w nagłówku dodatkowo **Panel gospodarza**.

### Konto nie jest wymagane

Rezerwować można **bez rejestracji** — i tak zostaje. Rezerwacja anonimowa ma
`guest_user_id = NULL`, a dane kontaktowe zapisujemy jako snapshot.

Zalogowany gość dostaje formularz wypełniony danymi z profilu, ale może je
zmienić — należą do tej konkretnej rezerwacji, nie do konta. **Późniejsza edycja
profilu nie zmienia historycznych rezerwacji.**

### Dopisanie anonimowej rezerwacji do konta

Na stronie statusu rezerwacji pojawia się „Zapisz tę podróż na koncie". Żeby
przypisanie doszło do skutku, muszą zgadzać się **trzy rzeczy naraz**:

```text
zalogowane konto
+ ważny token dostępu z linku w mailu
+ zgodny adres email
```

Sam numer rezerwacji ani sam adres email **nie wystarczają** — numer jest
drukowany w mailu i dyktowany przez telefon, a adres to wiedza publiczna.
Rezerwacja należąca już do innego konta nie da się przejąć.

### Podróże przeżywają archiwizację obiektu

Rezerwacja trzyma własny snapshot tytułu, miasta i okładki, więc „Moje podróże"
wygląda poprawnie nawet po tym, jak gospodarz wycofa obiekt z publikacji.

### Własnego obiektu nie zarezerwujesz

Gospodarz nie zarezerwuje własnego obiektu — pilnuje tego backend
(`409 CANNOT_BOOK_OWN_PROPERTY`), nie ukryty przycisk.

## Pobyt gościa

Po potwierdzeniu rezerwacji Rezervio samo dostarcza gościowi to, czego
potrzebuje. Gospodarz konfiguruje informacje **raz per obiekt**, w edycji
obiektu, w sekcji „Informacje dla gościa".

```text
Booking CONFIRMED
   → 24 h przed zameldowaniem: email ze szczegółami pobytu
   → 6 h przed zameldowaniem: dane wejścia stają się widoczne
   → 24 h przed wymeldowaniem: przypomnienie z instrukcją wyjazdu
   → po wymeldowaniu: Booking automatycznie COMPLETED
```

Gość **nie** klika „przyjechałem" ani „wyjechałem" — faza pobytu
(`BEFORE_STAY` / `IN_STAY` / `AFTER_STAY`) jest wyliczana z dat i strefy
czasowej obiektu.

### Dane dostępu

Kod do drzwi i lokalizacja keyboxa są szyfrowane w bazie i **nie są** wysyłane
mailem. Do momentu ujawnienia backend nie zwraca żadnego ich fragmentu — front
niczego nie ukrywa.

Gospodarz może udostępnić je jednemu gościowi wcześniej: w szczegółach
rezerwacji, przyciskiem **Udostępnij teraz**. Dotyczy to wyłącznie tej
rezerwacji — domyślne ustawienie obiektu zostaje bez zmian.

### Wiadomości

Rozmowa istnieje tylko wewnątrz rezerwacji: gość pisze ze strony statusu
rezerwacji, gospodarz z `/host/bookings/[id]`. Każda wiadomość generuje jeden
email do drugiej strony (treść zostaje w Rezervio). Widok odświeża się przez
polling — bez WebSocketów.

Godziny zameldowania i zasady domu są jedyną częścią informacji o pobycie
widoczną publicznie na stronie obiektu.

## Płatności (Stripe sandbox)

> Rezervio uznaje pieniądze **dopiero** po zweryfikowanym podpisem webhooku od
> operatora. Komunikat z przeglądarki nie potwierdza rezerwacji.

Danych karty backend nie widzi: numer, CVC i data ważności są wpisywane w ramce
Stripe Elements i lecą prosto do operatora.

### Klucze

Rozwój działa **wyłącznie na kluczach testowych**. Weź je z panelu Stripe
(tryb testowy) i wpisz do `.env`:

```env
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_FEE_BPS=0
```

Stripe nie jest częścią lokalnej infrastruktury — w `compose.yml` nadal są tylko
PostgreSQL, object storage, Redis i Mailpit.

Klucz publikowalny musi być **także** w `apps/web/.env` — Next.js wczytuje
zmienne z katalogu aplikacji, nie z korzenia monorepo.

### Webhooki lokalnie

Publiczny adres nie jest potrzebny. Stripe CLI przekierowuje zdarzenia na
localhost:

```bash
brew install stripe/stripe-cli/stripe   # albo: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3001/api/webhooks/stripe

# bez logowania w przeglądarce działa też:
stripe listen --api-key sk_test_... --forward-to localhost:3001/api/webhooks/stripe
```

`stripe listen` wypisuje przy starcie sekret podpisu (`whsec_…`) — to jest
wartość `STRIPE_WEBHOOK_SECRET`. Po jej zmianie zrestartuj API.

### Karty testowe

Nigdy nie używaj prawdziwej karty. Dowolna przyszła data ważności i dowolny CVC.

| Karta | Co się dzieje |
| --- | --- |
| `4242 4242 4242 4242` | płatność się udaje |
| `4000 0000 0000 0002` | odmowa (`card_declined`) |
| `4000 0025 0000 3155` | wymaga 3-D Secure |

### Przepływ

```text
Booking PENDING_PAYMENT
   → /booking/status/[reference] pokazuje formularz płatności
   → Guest płaci kartą testową
   → stripe listen przekazuje payment_intent.succeeded
   → Booking CONFIRMED, Hold CONVERTED, blokada BOOKING_HOLD → BOOKING
```

Po odmowie rezerwacja **zostaje** w `PENDING_PAYMENT` — Guest może spróbować
ponownie, dopóki blokada terminu żyje. Po jej wygaśnięciu ponowienie nie jest
możliwe.

### Ręczne scenariusze

```bash
# powtórzenie zdarzenia — nie może dać drugiego efektu
stripe events resend evt_...

# podgląd tego, co poszło na webhook
stripe listen --print-json
```

Spóźniona płatność (webhook po wygaśnięciu blokady) nie potwierdza rezerwacji:
Booking zostaje `EXPIRED` z powodem `PAYMENT_AFTER_HOLD_EXPIRY`, a Rezervio
zleca **jeden** pełny zwrot.

### Gospodarz

`/host/payments` to finanse gospodarza: ile zarobił, kiedy środki się zwolnią
i gdzie właśnie są. Tam też prowadzi konfiguracja konta rozliczeniowego (Stripe
Connect) — weryfikację robi operator na własnych stronach, Rezervio nie zbiera
dokumentów ani numerów kont.

Wymaga **włączonego Connect** na koncie Stripe
([dashboard.stripe.com/connect](https://dashboard.stripe.com/connect)). Bez tego
tworzenie konta rozliczeniowego i przelewy zwracają błąd dostawcy.

### Droga pieniędzy

Cztery różne rzeczy, których nie mylimy:

```text
Payment     gość                → Rezervio
Settlement  ile należy się gospodarzowi i od kiedy
Transfer    saldo platformy     → konto rozliczeniowe gospodarza
Payout      konto rozliczeniowe → bank gospodarza
```

```text
Płatność zaksięgowana
   → Settlement PENDING (kwoty ze snapshotu rezerwacji)
   → zameldowanie + 24 h: AVAILABLE
   → przelew na konto gospodarza: TRANSFERRED
   → wypłata do banku: robi ją operator, my ją obserwujemy
```

Udana płatność **nie** znaczy, że gospodarz dostał pieniądze. Odstęp ustawia
`HOST_SETTLEMENT_RELEASE_DELAY_HOURS`.

Zwrot przed przelewem anuluje rozliczenie. Zwrot po przelewie zleca dokładnie
jedno cofnięcie przelewu — zwrot obciążenia sam z siebie nie odbiera pieniędzy
gospodarzowi.

W środowisku testowym nie trzeba czekać doby: na liście rozliczeń jest przycisk
**Zwolnij środki teraz — sandbox**, który pomija wyłącznie zegar.

## Lokalizacja obiektu i mapy

> **Adres prowadzi do zapisanych współrzędnych, a wszystkie mapy używają
> dokładnie tych samych liczb.** Nic nie wylicza punktu z nazwy miasta i nic go
> nie losuje.

### Jak gospodarz ustawia lokalizację

```text
wpisuje ulicę, kod, miasto, kraj
      ↓ po chwili przerwy w pisaniu
mapa przesuwa się na znaleziony adres, znacznik ląduje w tym miejscu
      ↓ jeśli trafiliśmy obok
gospodarz przeciąga znacznik na właściwy budynek
      ↓
zapisujemy poprawiony punkt
```

Przeciągnięty znacznik zapisuje się tą samą ścieżką co wynik geokodera i ma
przed nim pierwszeństwo: ponowna edycja adresu nie cofnie ręcznej korekty.
Cofnąć ją może wyłącznie kliknięcie **Znajdź z adresu**.

Gdy geokoder trafi tylko w miasto, formularz mówi to wprost — „gdzieś
w Gdańsku" nie jest lokalizacją obiektu.

### Geokoder

Domyślnie **Nominatim** (OpenStreetMap): bez konta, bez klucza i z tymi samymi
danymi co podkład mapy, który już renderujemy — punkt i kafel zgadzają się co
do tego, gdzie jest ulica.

Działa po stronie serwera, nie w przeglądarce: polityka Nominatima prosi o maks.
jedno żądanie na sekundę i User-Agent identyfikujący aplikację, a adres
gospodarza nie opuszcza wtedy origin Rezervio. Rezervio dokłada kolejkę i cache,
żeby te prośby respektować.

```env
GEOCODING_CONTACT_EMAIL=   # trafia do User-Agent; ustaw przed wdrożeniem
```

Wymiana dostawcy to jedna klasa za `GeocodingProvider` — nie ma tu rejestru
providerów, bo jest dokładnie jeden.

### Czego nie zapiszemy jako lokalizacji

```text
NaN
0, 0            Zatoka Gwinejska — tak wygląda odpowiedź, której nikt nie sparsował
poza zakresem   |lat| > 90, |lon| > 180
połowa punktu   szerokość bez długości
```

### Wyszukiwanie zaczyna się puste

Pierwsze wejście to pusty formularz — bez domyślnego miasta i bez domyślnego
terminu.

```text
1. parametry z URL      to, o co poproszono, albo link, który ktoś dostał
2. ostatnie wyszukiwanie  z tej przeglądarki
3. puste
```

URL zawsze wygrywa. Zapamiętane wyszukiwanie wchodzi wyłącznie przy gołym
`/search` i wtedy trafia do adresu, stając się wyszukiwaniem jak każde inne.

## Panel gospodarza

Rejestracja jest otwarta — `/host/register` tworzy w jednej transakcji `User`,
`Host` i sesję, po czym przenosi do panelu.

```text
/host/register  →  /host  →  /host/properties/new  →  /host/properties/[id]
                                                             ↓
                                          uzupełnij → zdjęcia → Opublikuj
                                                             ↓
                                              publiczny /search i /property/[slug]
```

Nowy obiekt powstaje jako **szkic** (`DRAFT`) i może być niekompletny. Panel
pokazuje, czego jeszcze brakuje do publikacji — ta lista pochodzi z backendu,
który jest jedynym źródłem prawdy dla reguł publikacji.

Cykl życia obiektu:

```text
DRAFT ──publish──▶ PUBLISHED ──unpublish──▶ SUSPENDED
  │                    │                        │
  └────────────────────┴────archive─────────────┴──▶ ARCHIVED
```

Tylko `PUBLISHED` trafia do publicznej wyszukiwarki. `ARCHIVED` jest stanem
końcowym — niczego nie usuwamy twardo.

Sesje są server-side w `HttpOnly` cookie, hasła hashowane Argon2id. Gospodarz
widzi i zmienia wyłącznie własne obiekty; cudzy obiekt zwraca `404`.

## Integracje z PMS i channel managerami

Rezervio ma być dodatkowym kanałem sprzedaży, a nie dodatkowym kalendarzem do
ręcznego przepisywania. `/host/integrations` podłącza system, w którym gospodarz
już prowadzi terminy.

Dwie relacje, celowo różne:

| | Kto dzwoni | Rola Rezervio |
| --- | --- | --- |
| **Hostaway** | Rezervio → PMS | klient, trzyma cudze klucze |
| **Channex** | channel manager → Rezervio | kanał sprzedaży, wystawia endpointy |

To nie jest jeden interfejs z dwiema implementacjami. Przy PMS pytamy o listingi
i rezerwacje; przy channel managerze większość integracji to mały serwer, który
ktoś inny odpytuje.

### Hostaway

Wymaga **Account ID i API key** z panelu Hostaway (Settings → Hostaway API).

```text
/host/integrations → Połącz Hostaway
      ↓ klucz jest weryfikowany u dostawcy, dopiero potem zapisywany (zaszyfrowany)
Mapowania → wybierz obiekt dla każdego listingu i potwierdź
      ↓
rezerwacje z innych kanałów blokują terminy w Rezervio
rezerwacje z Rezervio trafiają do Hostaway
```

Przy łączeniu pokazujemy **raz** hasło webhooka. Wklej je razem z adresem
w Hostaway → Settings → Integrations → Webhooks (login: `rezervio`). Hostaway
nie podpisuje webhooków — jego kontrakt przewiduje Basic Auth i tyle sprawdzamy.
Hasła nie da się odczytać później; po zgubieniu połącz ponownie.

Webhook jest szybką ścieżką. Nawet bez niego okresowy sweep odpytuje dostawcę —
zgubione powiadomienie kosztuje opóźnienie, nie utratę rezerwacji.

### Channex

Wymaga dostępu partnerskiego, w tej kolejności:

1. konto na `staging.channex.io` z testową property;
2. utworzenie **Open Channel** w panelu Channex;
3. `api-key` i `hotel_code`;
4. przejście certyfikacji (Channex podaje **300 USD rocznie**, płatne przed
   certyfikacją).

Bez tego połączenie pokazuje `PARTNER_ACCESS_REQUIRED`, a endpointy kanału
odpowiadają `503` z tym samym kodem. Zaimplementowana jest granica providera,
model mapowania, endpointy z opublikowanego Open Channel API i testy kontraktowe.

Model Channexa jest hotelowy (room types, rate plans). Rezervio takie nie jest:
jeden obiekt to jedna niezależnie rezerwowalna jednostka, więc mapowanie to
zawsze jeden room type z jednym rate planem, a ceny z kanału są ignorowane
(`read_only`).

### Czego integracja nie robi

```text
zdjęcia
opisy
model cenowy i opłaty
wiadomości
opinie
```

### Co się dzieje przy konflikcie

Jeśli rezerwacja zewnętrzna trafi na terminy, które Rezervio już sprzedało,
blokada i tak powstaje — te noce naprawdę są zajęte — a konflikt trafia do
`/admin/operations`. Blokowanie mocniej nie naprawia podwójnej sprzedaży; ktoś
musi zdecydować.

Jeśli przekazanie potwierdzonej rezerwacji do dostawcy się nie powiedzie,
**rezerwacja zostaje potwierdzona**. Ponowienie idzie z backoffem, a problem
jest widoczny dla gospodarza i dla wsparcia.

### iCal zostaje

Można mieć oba naraz. Jeśli to samo źródło jest podłączone natywnie i przez
iCal, ten sam termin przyjdzie dwa razy — Rezervio ostrzega na
`/host/integrations` i niczego nie wyłącza za gospodarza.

## Panel administracyjny i wsparcie

`/admin` to narzędzie diagnostyczne dla zespołu wsparcia. Można z niego
**ponawiać** operacje, których nie da się ponowić z zewnątrz — nigdy ustawiać
stanów domenowych ręcznie.

### Nadanie roli lokalnie

Rola nie pochodzi z API. API, które potrafi wypromować konto do ADMIN, jest API
wartym ataku, a pierwszy administrator i tak musi powstać poza aplikacją.

```bash
# 1. załóż zwykłe konto przez /register w przeglądarce
# 2. nadaj mu rolę przy bazie
pnpm admin:grant ada@example.com ADMIN     # albo SUPPORT
pnpm admin:grant ada@example.com --revoke  # odebranie
```

Potem otwórz [localhost:3000/admin](http://localhost:3000/admin). Konto bez roli
dostaje tam czytelne „Brak uprawnień", a każdy endpoint `/api/admin/*` odpowiada
`403 ADMIN_FORBIDDEN` — także ten, do którego UI nie prowadzi linku.

### Co jest w panelu

| Strona | Do czego służy |
| --- | --- |
| `/admin` | co teraz nie działa, ostatnie rezerwacje, nieudane zadania, stan rekoncyliacji |
| `/admin/search` | jedno pole: numer rezerwacji, email, nazwa obiektu, `pi_…`, `re_…`, `tr_…`, `po_…` |
| `/admin/bookings/:id` | pełna droga pieniędzy: płatność → zwrot → rozliczenie → przelew → wypłata |
| `/admin/operations` | problemy operacyjne i rekoncyliacja |
| `/admin/jobs` | rejestr kolejek BullMQ i zadania, które wyczerpały ponowienia |
| `/admin/integrations` | połączenia z PMS i channel managerami, ich stan i bezpieczne akcje |
| `/admin/ical` | stan synchronizacji kalendarzy zewnętrznych |
| `/admin/notifications` | dostarczenia powiadomień, nieudane najpierw |

Na każdej stronie widnieje badge **STRIPE TEST MODE**. Rezervio działa wyłącznie
w sandboxie — klucz live zatrzymuje start procesu w każdym środowisku.

### Jak zasymulować awarię

Wszystko poniżej odtwarza stan, który w produkcji powstałby sam. Panel ma go
**pokazać** i pozwolić ponowić właściwą komendę.

```bash
# nieudane powiadomienie
psql "$DATABASE_URL" -c "UPDATE notification_deliveries
  SET status='FAILED', last_error_code='SMTP_550', sent_at=NULL
  WHERE booking_id='<id>';"

# nieudana synchronizacja kalendarza
psql "$DATABASE_URL" -c "UPDATE external_calendars
  SET consecutive_failures=4, last_sync_failed_at=now(), last_error_code='FETCH_FAILED'
  WHERE id='<id>';"

# rozliczenie zawieszone po terminie zwolnienia
psql "$DATABASE_URL" -c "UPDATE booking_settlements
  SET release_at = now() - interval '2 hours' WHERE id='<id>';"

# nieudane zadanie w kolejce — wystarczy zepsuć feed iCal i poczekać na retry
```

Problem pojawi się w `/admin/operations` razem z akcją, która go dotyczy.
Kliknięcie akcji uruchamia **istniejącą komendę domenową**, więc wszystkie
niezmienniki obowiązują: ponowione powiadomienie nadal zajmuje wiersz
`dedup_key`, a ponowiony przelew nadal mieści się w częściowym unikalnym
indeksie i nie zapłaci gospodarzowi dwa razy.

### Rekoncyliacja na żądanie

`Uruchom rekoncyliację` na pulpicie albo w `/admin/operations` odpala ten sam
przebieg, który chodzi automatycznie co `SETTLEMENT_RECONCILE_MINUTES`: zwalnia
należne rozliczenia, dopytuje dostawcę o zawieszone przelewy, ponawia nieudane
i odczytuje wypłaty. Wynik — ile zwolniono, ile uzgodniono, ile rozbieżności
zostało — widać od razu, a wpis trafia do audytu razem z tym, kto go uruchomił.

### Zdrowie procesu

```bash
curl localhost:3001/api/health   # liveness — sam proces, bez zależności
curl localhost:3001/api/ready    # readiness — PostgreSQL + Redis, 503 gdy któraś padnie
```

Każde żądanie dostaje `x-request-id` (własny albo przekazany przez klienta) i ten
sam identyfikator trafia do każdej linii logu.

## Zdjęcia i object storage

Zdjęcia nie przechodzą przez API — przeglądarka dostaje **presigned URL**
i wysyła plik wprost do storage, a backend zapisuje dopiero potwierdzone
`PropertyImage`.

Lokalnie storage to MinIO uruchamiane przez `pnpm infra:start`. Bucket i polityka
publicznego odczytu tworzą się same przy starcie API — nic nie trzeba klikać
w konsoli.

Limity (walidowane po stronie serwera): JPEG/PNG/WebP, 10 MB na zdjęcie,
30 zdjęć na obiekt. `position = 0` to zdjęcie główne.

Produkcyjnie ten sam kod działa na DigitalOcean Spaces — wystarczy zmienić
zmienne `S3_*`. Lista hostów dozwolonych dla `next/image` jest wyprowadzana
z `S3_PUBLIC_BASE_URL`, więc zmiana storage nie wymaga edycji `next.config.ts`.

### Zdjęcia nie opuszczają Twojego komputera

Przeglądarka wysyła plik wprost pod adres z `S3_ENDPOINT`, czyli lokalnie do
kontenera MinIO. Nic nie jest wysyłane na zewnątrz.

Bucket ma politykę publicznego odczytu (żeby `next/image` mógł pobrać zdjęcie
bez podpisywania każdego żądania), dlatego **wszystkie porty infrastruktury są
związane z `127.0.0.1`**, a nie z `0.0.0.0`:

```text
127.0.0.1:5432   PostgreSQL
127.0.0.1:9000   object storage (S3)
127.0.0.1:9001   konsola storage
127.0.0.1:6379   Redis
127.0.0.1:1025   SMTP (Mailpit)
127.0.0.1:8025   skrzynka Mailpit
```

Inny komputer w tej samej sieci nie dosięgnie ani bazy, ani zdjęć. Jeśli
świadomie chcesz testować z telefonu w tej samej sieci, zmień bindy
w `scripts/infra.sh` i `compose.yml` — ale wtedy wgrane zdjęcia stają się
dostępne dla całej sieci lokalnej.

Next 16 domyślnie odmawia optymalizacji obrazów z hostów rozwiązujących się na
prywatne IP (ochrona przed SSRF). Lokalne MinIO jest właśnie takim hostem, więc
`images.dangerouslyAllowLocalIP` jest włączone **wyłącznie w developmencie** —
w produkcji `S3_PUBLIC_BASE_URL` wskazuje publiczny host i flaga pozostaje
wyłączona.

## Panel gospodarza

`/host` odpowiada na jedno pytanie: **co teraz wymaga mojej reakcji**. Kolejność
sekcji jest celowa — najpierw sprawy do załatwienia, liczby na końcu.

```text
Wymaga uwagi  →  Dziś (przyjazdy/wyjazdy)  →  Prośby  →  Najbliższe pobyty
              →  Obiekty  →  Synchronizacja kalendarzy
```

Cały ekran to jedno żądanie `GET /api/host/dashboard`. Pulpit nie ma własnego
stanu — jest liczony z rezerwacji, obiektów i blokad. „Dziś” jest liczone
w strefie czasowej obiektu, nie serwera.

Akceptacja i odrzucenie prośby prosto z pulpitu idą przez te same komendy, co
lista rezerwacji — nie ma drugiej ścieżki zmiany statusu.

## Kalendarz i dostępność

`/host/calendar` pokazuje **wszystkie obiekty naraz**: wiersze to obiekty,
kolumny to dni miesiąca. Filtr obiektu i tryb listy (wygodniejszy na telefonie)
pokazują tę samą projekcję. Zaznaczenie zakresu w wierszu blokuje albo zwalnia
termin przez zwykłe endpointy dostępności.

Rodzaj zajętości niesie litera, nie tylko kolor:

| Znak | Znaczenie |
| --- | --- |
| `R` | rezerwacja |
| `T` | tymczasowa blokada (aktywny Hold) |
| `B` | ręczna blokada |
| `Z` | kalendarz zewnętrzny |

Wygasły Hold nie jest pokazywany — kalendarz i wyszukiwarka nigdy nie mówią
czegoś innego o tym samym terminie. Przy terminach z kalendarzy zewnętrznych nie
pokazujemy nazwiska gościa: to dane z cudzego feedu.

Każdy obiekt ma też własny kalendarz pod `/host/properties/[id]/calendar` — tam
mieszka import i eksport iCal. Zaznacz zakres
dwoma kliknięciami, a potem zablokuj albo zwolnij termin.

```text
blokada [12.09, 16.09)  →  pobyt 13–15.09 nie znajdzie obiektu
                        →  pobyt 16–18.09 znajdzie
```

Daty są **półotwarte**: dzień końcowy to dzień wyjazdu i pozostaje wolny.
Zdjęcie fragmentu blokady w środku dzieli ją na dwie — nie trzeba kasować całości.

Zablokowane terminy znikają z wyszukiwarki natychmiast; filtrowanie dzieje się
w SQL, nie na froncie.

### Import z innych serwisów

Podepnij feed iCal z Airbnb, Booking.com, Vrbo albo PMS-a. Rezervio odpytuje go
okresowo (domyślnie co 15 minut) i traktuje jak pełny obraz stanu: po każdej
udanej synchronizacji terminy są dopasowywane, a te, których feed już nie
wymienia, znikają.

Nieudana synchronizacja **nie kasuje** poprzednich blokad — awaria cudzego
serwera nie może przypadkiem otworzyć Twojego kalendarza.

> Kalendarze iCal nie synchronizują się w czasie rzeczywistym.

Adres feedu bywa poufny (często zawiera token), więc jest szyfrowany
AES-256-GCM, nie trafia do logów i nigdy nie wraca przez API w całości.

Backend pobiera tylko publiczne adresy: schemat `http`/`https`, z odrzuceniem
`localhost`, sieci prywatnych i endpointów metadanych chmury — sprawdzane też
po DNS i przy każdym przekierowaniu.

Żeby przetestować import lokalnym mockiem, ustaw w `.env`:

```env
ICAL_ALLOW_PRIVATE_HOSTS=true
```

Ta furtka jest ignorowana przy `NODE_ENV=production` — na produkcji ochrony
SSRF nie da się wyłączyć konfiguracją.

### Eksport do innych serwisów

Wygeneruj adres `.ics`, który zewnętrzny system może zasubskrybować. Token
pokazujemy raz, w bazie leży wyłącznie jego hash, a rotacja natychmiast
unieważnia poprzedni adres.

Eksport obejmuje **tylko blokady ręczne**. Terminy zaimportowane z cudzych
kalendarzy nigdy nie są odsyłane — inaczej dwa serwisy blokowałyby się
nawzajem w kółko. Feed nie zawiera notatek ani danych osobowych.

## Rezerwacje

Każdy obiekt ma **tryb rezerwacji**, ustawiany w edytorze (krok 6):

```text
REQUEST_TO_BOOK   (domyślny)  gospodarz akceptuje każdą rezerwację
INSTANT_BOOK                  gość rezerwuje od razu
```

Ścieżka gościa:

```text
/property/[slug]  →  „Wyślij prośbę" / „Zarezerwuj"
        ↓
/booking/[slug]   →  termin, cena, dane kontaktowe
        ↓
/booking/status/[reference]
```

Gość nie potrzebuje konta. Rezerwacja zapisuje snapshot jego danych i **snapshot
ceny** — późniejsza zmiana stawki przez gospodarza nie rusza tego, co już
uzgodniono. Cenę wylicza serwer; kwota przysłana przez przeglądarkę jest
ignorowana.

Gospodarz widzi prośby w **/host/bookings** i tam je akceptuje albo odrzuca.
Lista ma wyszukiwanie po numerze rezerwacji, imieniu i emailu gościa, filtry
(status, obiekt, zakres pobytu), sortowanie i stronicowanie — wszystko w URL,
więc odfiltrowany widok da się wysłać linkiem.

### Statusy

| Status | Znaczenie |
| --- | --- |
| `PENDING_HOST_APPROVAL` | czeka na gospodarza — **termin pozostaje wolny** |
| `PENDING_PAYMENT` | termin zablokowany Holdem, czeka na płatność |
| `CANCELLED` | odrzucona przez gospodarza |
| `EXPIRED` | Hold wygasł albo termin zajął się przed akceptacją |
| `CONFIRMED` | po zaksięgowanej płatności |

Prośba o rezerwację celowo **nie blokuje** kalendarza — inaczej niezdecydowany
gospodarz zamrażałby termin, nie podejmując decyzji. Blokada powstaje dopiero
przy akceptacji, po ponownym sprawdzeniu dostępności.

### Ochrona przed podwójną rezerwacją

Dwóch gości klikających „Zarezerwuj" w tej samej sekundzie nie może obaj wygrać.
Każdy zapis zmieniający dostępność bierze **advisory lock PostgreSQL na
Property**, przeładowuje stan i sprawdza dostępność **ponownie, wewnątrz
transakcji**. Drugi dostaje `409 PROPERTY_NOT_AVAILABLE`.

`POST /api/bookings` wymaga nagłówka `Idempotency-Key`: ponowione wysłanie
formularza zwraca tę samą rezerwację, a nie drugą.

Hold wygasa po `BOOKING_HOLD_TTL_SECONDS` (domyślnie 10 minut) i **przestaje
blokować natychmiast** — nawet jeśli job sprzątający się spóźni. Redis obsługuje
tylko sprzątanie; źródłem prawdy o dostępności jest PostgreSQL.

## Powiadomienia i lokalne testowanie e-maili

Wszystkie maile lokalnie łapie **Mailpit** — nic nie wychodzi na zewnątrz.
Skrzynkę otwierasz w przeglądarce:

```text
http://localhost:8025
```

Kiedy co wychodzi:

| Zdarzenie | Do kogo |
| --- | --- |
| Nowa prośba o rezerwację | gospodarz |
| Przypomnienie przed wygaśnięciem prośby | gospodarz |
| Gość anulował | gospodarz |
| Prośba zaakceptowana | gość |
| Prośba odrzucona | gość |
| Prośba wygasła | gość |
| Gospodarz anulował | gość |

Email jest **efektem ubocznym**, nigdy częścią transakcji. Zmiana stanu
rezerwacji i zapis do outboxa dzieją się razem, a wysyłka dopiero po commicie —
awaria SMTP nie może zablokować rezerwacji. Każde powiadomienie ma logiczny
klucz dedup, więc ponowienie nie wyśle drugiego maila.

## Rezerwacja z perspektywy gościa

Gość nie zakłada konta. Po wysłaniu formularza dostaje **bezpieczny link**:

```text
/booking/status/RZV-XXXXXXXX?token=…
```

Token jest wymieniany na `HttpOnly` cookie i znika z adresu. Sam numer
rezerwacji **nie wystarcza** — jest drukowany w mailu i dyktowany przez telefon,
więc identyfikuje rezerwację, ale niczego nie autoryzuje.

Na stronie statusu gość widzi termin, cenę, status, historię i — jeśli to
jeszcze możliwe — przycisk anulowania.

### Wygasanie prośby

Prośba o rezerwację ma deadline (`BOOKING_REQUEST_TTL_SECONDS`, domyślnie 24 h).
Deadline leży **w bazie**, nie w kolejce: gospodarz nie zaakceptuje prośby po
czasie, nawet jeśli worker jeszcze nie zdążył jej domknąć.

Kilka godzin przed końcem gospodarz dostaje przypomnienie
(`BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY`).

### Anulowanie

Anulować mogą obie strony, dopóki rezerwacja czeka na gospodarza albo na
płatność. Jeśli termin był zablokowany, blokada znika w tej samej transakcji
i obiekt od razu wraca do wyszukiwarki.

## Skrypty

| Komenda | Opis |
| --- | --- |
| `pnpm dev` | web + api równolegle |
| `pnpm dev:web` / `pnpm dev:api` | pojedyncza aplikacja |
| `pnpm build` | build wszystkich pakietów |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | kontrola jakości w całym monorepo |
| `pnpm infra:start` / `pnpm infra:stop` | lokalna infrastruktura (baza + storage + Redis + Mailpit) |
| `pnpm infra:reset` | usuwa wolumeny i stawia infrastrukturę od zera |
| `pnpm db:migrate` / `pnpm db:seed` | migracje i dane demo (seed jest idempotentny) |
| `pnpm db:reset` | infrastruktura od zera + migracje + seed |
| `pnpm db:generate` | nowa migracja Drizzle ze zmian w schemacie |
| `pnpm api:types` | regeneruje typy klienta z OpenAPI (API musi działać) |
| `pnpm admin:grant <email> [ADMIN\|SUPPORT\|--revoke]` | nadaje albo odbiera rolę administracyjną |

`pnpm infra:start` używa `podman compose`, jeśli w systemie jest provider
Compose. Gdy go nie ma — a `podman compose` wymaga zewnętrznego
`docker-compose` albo `podman-compose` — skrypt uruchamia te same kontenery
bezpośrednio przez `podman run`. `compose.yml` pozostaje deklaratywnym opisem
tej samej infrastruktury.

Testy integracyjne i smoke API korzystają z lokalnej bazy — przed `pnpm test`
uruchom `pnpm infra:start && pnpm db:migrate && pnpm db:seed`.

## Struktura

```text
apps/
  web/          Next.js — UI publiczne, panel gospodarza, mapa
  api/          NestJS + Fastify — REST, auth, Drizzle, migracje, seed
packages/
  api-client/   typowany fetch client z typami generowanymi z OpenAPI
containers/
  postgres/     obraz z PostGIS, pg_trgm i pgvector
docs/           język domenowy, architektura, milestone'y
deploy/         skrypty wdrożeniowe na droplet
compose.yml     lokalna infrastruktura (baza + object storage + Redis + Mailpit)
scripts/        infra.sh — start/stop/reset infrastruktury
```

Szczegóły: [docs/architecture.md](docs/architecture.md).
Terminologia: [docs/rezervio-domain-language.md](docs/rezervio-domain-language.md).

## Dane

Katalog demo (31 Property, jeden Host, 15 Amenity) żyje w jednym miejscu:
`apps/api/src/infrastructure/database/seed/demo-properties.ts`. Frontend nie ma
własnej kopii — wszystko pobiera z API.

Żeby dodać obiekt: dopisz rekord do `DEMO_PROPERTIES` i uruchom `pnpm db:seed`.
Kwoty podawaj w **minor units** (`45000` = 450,00 PLN), a kody Amenity wielkimi
literami (`SEA_VIEW`). Nowy host obrazków wymaga wpisu w `images.remotePatterns`
w `apps/web/next.config.ts`.

Kanoniczna lista Amenity mieszka w `apps/api/src/domain/amenities.ts` i jest
wystawiona pod `GET /api/amenities` — seed, panel gospodarza i filtry korzystają
z tego samego źródła.

## Zmiany w schemacie

Zawsze przez migracje, nigdy przez `push`:

```bash
# 1. zmień apps/api/src/infrastructure/database/schema.ts
pnpm db:generate
# 2. przejrzyj wygenerowany SQL w apps/api/drizzle/
pnpm db:migrate
```

Rzeczy, których Drizzle nie modeluje — rozszerzenia, kolumna `geography`,
`tsvector`, indeksy GiST/GIN/trigram — są w ręcznej migracji
`apps/api/drizzle/0001_geo_and_search.sql`.

## Środowisko

`.env` w korzeniu obsługuje API i skrypty bazodanowe; `apps/web/.env` obsługuje
Next.js, który czyta zmienne z katalogu aplikacji, nie z korzenia monorepo.
Wzorce bez sekretów są w `.env.example`.

Klucz szyfrowania adresów iCal wygeneruj sam — bez niego API nie wstanie:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Wynik wpisz do `ICAL_URL_ENCRYPTION_KEY` w `.env`.

Zmienne dodane w Milestone 05:

```env
APP_BASE_URL=http://localhost:3000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
EMAIL_FROM=no-reply@rezervio.local

BOOKING_REQUEST_TTL_SECONDS=86400
BOOKING_REQUEST_REMINDER_SECONDS_BEFORE_EXPIRY=14400
```

Linki w mailach budujemy **wyłącznie** z `APP_BASE_URL`, nigdy z nagłówka
`Host` żądania.

Zmienne dodane w Milestone 04:

```env
BOOKING_HOLD_TTL_SECONDS=600
BOOKING_IDEMPOTENCY_TTL_SECONDS=86400
```

Zmienne dodane w Milestone 03:

```env
REDIS_URL=redis://localhost:6379

ICAL_SYNC_INTERVAL_MINUTES=15
ICAL_FETCH_TIMEOUT_MS=10000
ICAL_MAX_RESPONSE_BYTES=5242880
ICAL_URL_ENCRYPTION_KEY=
ICAL_ALLOW_PRIVATE_HOSTS=false
```

Zmienne dodane w Milestone 02:

```env
SESSION_COOKIE_NAME=rezervio_session
SESSION_TTL_SECONDS=604800

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=rezervio-local
S3_ACCESS_KEY_ID=rezervio
S3_SECRET_ACCESS_KEY=rezervio-local-only
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_BASE_URL=http://localhost:9000/rezervio-local
```

Zmienne dodane w Milestone 11:

```env
# development | test | staging | production. Bez tego decyduje NODE_ENV.
# Staging dostaje produkcyjne reguły cookies i CORS, wciąż na sandboxie Stripe.
APP_ENV=development

# Jawna allowlista origin — nigdy '*' przy ciasteczkach. W produkcji wymagane https.
WEB_ORIGIN=http://localhost:3000

# Limity można przestrajać bez wdrożenia:
#   RATE_LIMIT_<BUCKET>_MAX / RATE_LIMIT_<BUCKET>_WINDOW
# Buckety: LOGIN, REGISTER, GUEST_ACCESS, PAYMENT_CREATE, MESSAGE_SEND,
#          ADMIN_SEARCH, ADMIN_ACTION
# RATE_LIMIT_ADMIN_SEARCH_MAX=30
```

Konfiguracja jest sprawdzana **przy starcie**. Brakujący sekret znaleziony przez
pierwsze żądanie, które go potrzebuje, to incydent; ten sam sekret znaleziony
przy starcie to nieudany deploy.

W środowisku produkcyjnym wymagane są `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`,
`APP_BASE_URL` i `ICAL_URL_ENCRYPTION_KEY`, a `WEB_ORIGIN` musi używać `https`.

Klucz `sk_live_…` / `rk_live_…` **zatrzymuje start procesu w każdym
środowisku** — produkcji nie wyłączając. Rezervio jest w sandboxie, a przejście
na żywe płatności to osobna, świadoma decyzja, nie zmiana zmiennej.

Cookies sesji i dostępu gościa mają `HttpOnly` zawsze, `SameSite=Lax` oraz
`Secure` w środowiskach produkcyjnych (`APP_ENV=production` albo `staging`) — na
localhost bez HTTPS przeglądarka by je odrzuciła.

Zmienne dodane w Milestone 12:

```env
# Osobny klucz na dane dostępowe dostawców. Gdy puste — ICAL_URL_ENCRYPTION_KEY.
PROVIDER_CREDENTIALS_ENCRYPTION_KEY=

EXTERNAL_SYNC_INTERVAL_MINUTES=15
EXTERNAL_SYNC_HORIZON_DAYS=365

# Z tego budujemy adres webhooka pokazywany gospodarzowi.
API_PUBLIC_URL=http://localhost:3001/api

HOSTAWAY_API_BASE_URL=https://api.hostaway.com

# Wymagają dostępu partnerskiego Channex — bez nich kanał raportuje
# PARTNER_ACCESS_REQUIRED, i tak ma być.
CHANNEX_INBOUND_API_KEY=
CHANNEX_API_KEY=
```

Adresy dostawców są **allowlistowane**. Base URL pochodzi z konfiguracji, a za
konfiguracją idzie nagłówek z naszym kluczem — podążanie za dowolnym adresem
byłoby SSRF-em z własnymi danymi dostępowymi w środku.

## Wdrożenie

Zobacz [DEPLOY.md](DEPLOY.md).
