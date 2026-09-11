# Rezervio — stan projektu

> Punkt wejścia dla kolejnego milestone. Zamiast czytać całą historię, zacznij
> stąd, a po szczegóły sięgnij do [architektury](./architecture.md) i
> [języka domenowego](./rezervio-domain-language.md).

Ostatni ukończony milestone: **12 — PMS / Channel Manager Connectivity**.

> **To nie jest jeszcze produkcyjne wydanie.** Stripe działa wyłącznie
> w sandboxie/trybie testowym, a klucz live zatrzymuje start procesu — w każdym
> środowisku. Przejście na żywe płatności wymaga osobnej, świadomej decyzji.

> **Integracje: Hostaway gotowy, Channex czeka na dostęp partnerski.**
> Pełny raport i lista punktów otwartych:
> [Milestone 12 — status i otwarte punkty](./rezervio-milestone-12-status-i-otwarte-punkty.md).
> Adapter Hostaway jest napisany pod opublikowany kontrakt i przetestowany
> kontraktowo oraz integracyjnie — ale Rezervio **nie ma konta Hostaway**, więc
> nie ma E2E przeciwko prawdziwemu API. Channex wymaga konta staging,
> zarejestrowanego Open Channel i płatnej certyfikacji; do tego czasu połączenie
> raportuje `PARTNER_ACCESS_REQUIRED`. Szczegóły niżej.

## Co działa

| Obszar | Stan |
| --- | --- |
| Katalog i wyszukiwarka | PostgreSQL jako baza i backend wyszukiwania; PostGIS, pg_trgm, pgvector |
| Lokalizacja i mapy | Adres → geokoder (Nominatim) → `Property.latitude/longitude`; przeciągany znacznik, jedno źródło prawdy dla wszystkich map |
| Konta | Wspólna tożsamość `User`; `Host` to opcjonalny profil, nie osobne konto |
| Obiekty | Edytor, zdjęcia w object storage, publikacja jako komenda domenowa |
| Dostępność | `daterange` półotwarty, advisory lock per Property, import/eksport iCal |
| Rezerwacje | `BookingHold` z TTL, idempotency w PostgreSQL, ochrona przed double bookingiem |
| Powiadomienia | Transakcyjny outbox → BullMQ → SMTP, dedup po `dedup_key` |
| Konto gościa | Bezpieczny claim rezerwacji, „Moje podróże" |
| Panel gospodarza | Pulpit action-first, wspólny kalendarz wszystkich obiektów |
| Płatności | Stripe sandbox, webhook jako źródło prawdy, atomowa konwersja Hold → Booking, zwroty |
| Pobyt | StayInformation per Property, szyfrowany dostęp z kontrolowanym ujawnieniem, rozmowa w rezerwacji, automatyczne `COMPLETED` |
| Rozliczenia | Settlement ze snapshotu rezerwacji, zwolnienie po `check-in + delay`, Stripe Connect Transfer, cofnięcie po zwrocie, obserwacja wypłat, rekoncyliacja |
| Admin i support | `/admin` za rolą `SUPPORT`/`ADMIN`, globalne wyszukiwanie, pełny cykl życia rezerwacji, problemy operacyjne jako read model, bezpieczne ponowienia, audyt |
| Observability | `requestId` w każdym logu i odpowiedzi, redakcja sekretów, rozdzielone `/health` i `/ready`, taksonomia kodów błędów |
| Hardening | Walidacja env przy starcie, guard na klucz live, cookies, ochrona Origin, rate limiting, nagłówki bezpieczeństwa, ochrona przed brute-force |
| Connectivity | Połączenia, mapowanie obiektów, rezerwacje w obie strony, webhook + polling, rekoncyliacja; adapter Hostaway (PMS) i kanał Channex (Rezervio jako OTA) |

## Czego celowo nie ma

```text
przełącznik test → live w Stripe
działająca integracja Channex (brak dostępu partnerskiego)
hotelowe inventory: room type, allotment, multi-room booking
rozliczanie zwrotów częściowych
podział przychodu między wielu gospodarzy
księga kosztów Stripe, VAT, faktury
chargebacki i spory
reviews
WebSockets
manualny check-in / check-out gościa
globalny messenger User↔User
załączniki w wiadomościach, SMS, push
smart locki i generowanie kodów do drzwi
```

## Zasady, których nie łamiemy

- **PostgreSQL jest źródłem prawdy.** Redis trzyma zadania, nigdy odpowiedzi.
- **Każdy zapis zmieniający dostępność bierze advisory lock na Property**
  i sprawdza dostępność ponownie w tej samej transakcji.
- **Cenę ustala serwer.** Kwota z przeglądarki jest ignorowana.
- **`Property.latitude/longitude` są jedynym źródłem prawdy dla map.** Nic nie
  wylicza punktu z nazwy miasta i nic go nie losuje.
- **Ręczna korekta znacznika wygrywa z geokoderem** — i jest o tym napisane
  wprost, gdy znaleziony punkt nie przesunął znacznika.
- **Kod kraju to kod ISO albo 400.** Nieistniejący kraj nie daje błędu
  u dostawcy, tylko pustą listę — czyli fałszywe „nie znaleźliśmy adresu".
- **URL ma pierwszeństwo przed zapamiętanym wyszukiwaniem.**
- **Płatność potwierdza wyłącznie zweryfikowany webhook.**
- **Sekrety ujawnia backend, nie front.** Przed terminem odpowiedź nie zawiera
  fragmentu sekretu.
- **Email nigdy nie blokuje transakcji** i nigdy nie wozi sekretów.
- **Konto nie jest wymagane do rezerwacji.**
- **Kwota dla gospodarza pochodzi ze snapshotu rezerwacji**, a przelew nigdy nie
  dzieje się od razu po płatności.
- **Payment, Settlement, Transfer i Payout to cztery różne rzeczy.**
- **Support ponawia, nie ustawia stanów.** Nie ma endpointu zapisującego status
  domenowy — każda akcja administracyjna uruchamia istniejącą komendę.
- **Rola administracyjna nie pochodzi z API.** Nadaje ją skrypt przy bazie.
- **Klucz live Stripe zatrzymuje start procesu** — w każdym środowisku.
- **Rezervio jest źródłem prawdy dla Booking i ostatecznej dostępności.**
  Zewnętrzny PMS dostarcza sygnały, nie decyzje.
- **Rezerwacja zewnętrzna nie jest Bookingiem** — jest mapowaniem plus blokadą.
- **Awaria dostawcy nie cofa potwierdzonej rezerwacji.**
- **PMS i channel manager to dwie różne relacje**, nie dwa warianty jednej.

Pełna lista granic: [architektura → „Granice, których pilnujemy"](./architecture.md#granice-których-pilnujemy).

## Uruchomienie

```bash
pnpm install
cp .env.example .env && cp apps/web/.env.example apps/web/.env
pnpm infra:start && pnpm db:migrate && pnpm db:seed
pnpm dev
```

Szczegóły — łącznie z sandboxem Stripe i skrzynką Mailpit — w [README](../README.md).

## Integracje lokalnie

```bash
# Hostaway — wymaga konta u dostawcy
# /host/integrations → Połącz Hostaway → Account ID + API key
# Bez konta: cała ścieżka domenowa jest pokryta testami z test double.

# Channex — wymaga dostępu partnerskiego (patrz „Wymagania środowiska")
CHANNEX_INBOUND_API_KEY=…   # klucz, którym Channex uwierzytelnia się u nas
CHANNEX_API_KEY=…           # klucz, którym my dostarczamy rezerwacje
```

## Panel administracyjny

```bash
# konto musi już istnieć (zwykła rejestracja przez /register)
pnpm admin:grant ada@example.com ADMIN     # albo SUPPORT
```

Potem `/admin` w przeglądarce. Nie ma endpointu nadającego rolę — API, które
potrafi wypromować konto do ADMIN, jest API wartym ataku.

## Bramki jakości

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pnpm test:e2e` nie istnieje; testy e2e żyją w `apps/api/tests/api.e2e.test.ts`
i wchodzą w `pnpm test`.

## Wymagania środowiska

Pełny przepływ finansowy wymaga **włączonego Stripe Connect** na koncie
testowym ([dashboard.stripe.com/connect](https://dashboard.stripe.com/connect)).
Bez tego tworzenie konta rozliczeniowego i przelewy zwracają błąd dostawcy —
reszta aplikacji działa normalnie, a rozliczenia zatrzymują się na `AVAILABLE`.

### Geokodowanie

Adresy obiektów rozwiązuje **Nominatim** (OpenStreetMap) — bez konta i bez
klucza. Jego polityka prosi o maks. jedno żądanie na sekundę i User-Agent
identyfikujący aplikację; oba są spełniane po stronie serwera, dlatego
geokodowanie nie działa z przeglądarki.

```env
GEOCODING_CONTACT_EMAIL=   # trafia do User-Agent; ustaw przed wdrożeniem
```

Bez kontaktu Rezervio i tak się przedstawia, ale wdrożenie o zauważalnym ruchu
powinno podać adres, pod którym można się z kimś skontaktować.

### Hostaway

Potrzebne: **Account ID i API key** z panelu Hostaway
(Settings → Hostaway API). API jest publiczne i osiągalne; bez kluczy każde
wywołanie zwraca `401`.

Stan: adapter napisany pod opublikowany kontrakt (`POST /v1/accessTokens`,
`GET /v1/listings`, `GET|POST|DELETE /v1/reservations`), pokryty testami
kontraktowymi przeciwko lokalnemu dublerowi HTTP i testami integracyjnymi na
całej ścieżce domenowej. **Nie przetestowany przeciwko prawdziwemu Hostaway** —
to wymaga konta.

### Channex

Potrzebne, w tej kolejności:

1. konto na `staging.channex.io` z testową property;
2. utworzenie **Open Channel** w panelu Channex;
3. `api-key` i `hotel_code` z tego kanału;
4. przejście certyfikacji (Channex podaje opłatę **300 USD rocznie**, płatną
   przed certyfikacją).

Do tego czasu połączenie ma `status = ACTION_REQUIRED`,
`reason = PARTNER_ACCESS_REQUIRED`, a endpointy kanału odpowiadają `503` z tym
samym kodem. Zaimplementowane są: granica providera, endpointy z opublikowanego
Open Channel API, model mapowania, testy kontraktowe i test double.

**Nie jest to działająca integracja Channex** i nie jest tak raportowana.

## Następny milestone

> **Milestone 13: Reviews & Post-Stay** — zweryfikowane opinie gości po
> zakończonym pobycie, oceny gospodarza i obiektu, podstawy moderacji oraz
> powiadomienie po pobycie.
