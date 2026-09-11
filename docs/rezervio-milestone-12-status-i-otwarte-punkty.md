# Milestone 12 — raport i punkty otwarte

> Dokument przekazania. Milestone 12 jest **ukończony w zakresie, który dało się
> wykonać bez dostępu do kont u dostawców**. Reszta czeka na dostęp partnerski
> i jest tu wypisana konkretnie, razem z tym, jak wznowić pracę.
>
> Data zamknięcia: 2026-09-06. Stan bramek: lint, typecheck, 659 + 67 testów,
> build — wszystko zielone.

---

## 1. Raport końcowy

### Common connectivity

```text
Connections:                PASS   external_inventory_connections, dane dostępowe AES-256-GCM
Property mapping:           PASS   unikalne w obie strony, zawsze zatwierdzane przez Hosta
Reservation mapping:        PASS   INBOUND/OUTBOUND, unikalne (connection, external_reservation_id)
Provider event idempotency: PASS   insert = pozwolenie na przetworzenie; replay → duplicate, brak efektu
Reconciliation:             PASS   zwalnia terminy po anulowaniu, którego webhook nie dotarł
Concurrency protection:     PASS   ten sam pg_advisory_xact_lock, co Booking/Hold/iCal/blokady ręczne
Admin visibility:           PASS   /admin/integrations + kategoria INTEGRATION w problemach operacyjnych
Host UI:                    PASS   /host/integrations, mapowanie, „Synchronizuj teraz", ostrzeżenie o iCal
```

### Hostaway

```text
Connection:          PASS   POST /v1/accessTokens, client_credentials, scope=general
Property discovery:  PASS   GET /v1/listings, propozycja po dokładnej nazwie
Mapping:             PASS   jawne potwierdzenie Hosta; cudzy Property → 404
Inbound reservation: PASS   GET /v1/reservations, statusy zredukowane do ACTIVE/CANCELLED/PENDING
Availability block:  PASS   EXTERNAL_PROVIDER; terminy przestają być rezerwowalne (409)
Outbound Booking:    PASS   POST /v1/reservations po CONFIRMED, przez outbox → kolejkę
Cancellation:        PASS   DELETE /v1/reservations/{id}; 404 traktowane jako „już anulowane"
Webhook/polling:     PASS   Basic Auth (Hostaway nie podpisuje) + sweep jako ścieżka odzyskiwania
Reconciliation:      PASS   ręcznie z /admin i automatycznie co EXTERNAL_SYNC_INTERVAL_MINUTES
External E2E:        NOT AVAILABLE — brak konta Hostaway
```

`https://api.hostaway.com` jest osiągalne i zwraca `401` bez kluczy. Adapter
napisano pod opublikowany kontrakt; **testy kontraktowe** sprawdzają, co
faktycznie idzie na drut (ścieżka, metoda, `Authorization: Bearer`, kształt
ciała, form-encoding tokena) przeciwko lokalnemu dublerowi HTTP.

### Channex

```text
OTA/channel access:  PARTNER_ACCESS_REQUIRED
Connection:          NOT AVAILABLE
Mapping:             PASS   (model + mapping_details w kształcie z kontraktu)
Inventory flow:      NOT AVAILABLE   (endpoint changes/ zaimplementowany i przetestowany lokalnie)
Reservation flow:    NOT AVAILABLE
Cancellation:        NOT AVAILABLE
Webhook/events:      NOT AVAILABLE
Reconciliation:      NOT AVAILABLE
Contract tests:      PASS
```

Channex **nie jest** drugim adapterem Hostaway. Rezervio jest tu kanałem, więc
większość integracji to mały serwer, który Channex odpytuje:

```text
Channex → Rezervio   GET  /api/channels/channex/test_connection
                     GET  /api/channels/channex/mapping_details
                     POST /api/channels/channex/changes
Rezervio → Channex   POST /api/v1/channel_webhooks/open_channel/new_booking
                                                  …/booking_availability_check
                                                  …/request_full_sync
```

Wszystkie sześć pochodzi z opublikowanego Open Channel API. Nic nie zostało
wymyślone.

### Security

```text
Credential encryption:   PASS   AES-256-GCM, własny klucz, prefiks v1.; deszyfrowanie tylko w adapterze
Cross-Host isolation:    PASS   cudze połączenie → 404 (nie 403); mapowanie cudzego Property → 404
Webhook validation:      PASS   Hostaway: Basic Auth w czasie stałym; Channex: nagłówek api-key
Sensitive log redaction: PASS   0 wystąpień klucza, ciphertextu, nagłówka Bearer i api-key w logach
```

Dodatkowo: allowlista domen dostawcy (SSRF z naszymi własnymi kluczami
w nagłówku byłby najgorszym wariantem), a payload zdarzenia jest **hashowany,
nie przechowywany**.

### Quality

```text
lint:                 PASS   apps/api, apps/web
typecheck:            PASS   apps/api, apps/web, packages/api-client
unit tests:           PASS   659 (api) + 67 (web) — z 575 + 62 przed milestone
integration/e2e:      PASS   w tym samym przebiegu; pnpm test:e2e nie istnieje
build:                PASS   nest build + next build
manual Hostaway flow: PASS   14/14 kroków, przeciwko dublerowi (brak konta u dostawcy)
manual Channex flow:  PASS   ścieżka „brak dostępu": 503 PARTNER_ACCESS_REQUIRED na wszystkich trzech
                             endpointach, brak wymyślonych ścieżek, blocker udokumentowany
```

### Ważne decyzje

1. **Dwa interfejsy, nie jeden.** `InventoryProvider` (dzwonimy do PMS)
   i `ChannelProvider` (channel manager dzwoni do nas) nie mają wspólnej
   abstrakcji. `ProviderRegistry.inventoryProvider('CHANNEX')` zwraca `null` —
   to odpowiedź, nie luka.
2. **Rezerwacja zewnętrzna nie staje się Bookingiem.** Nie ma gościa Rezervio,
   ceny, którą ustaliliśmy, ani płatności. Jest mapowaniem plus
   `AvailabilityBlock(EXTERNAL_PROVIDER)`.
3. **Zajmujemy wiersz, potem dzwonimy** — jak przy przelewach do gospodarza.
   Częściowy unikalny indeks `(connection, booking_id) WHERE
   direction='OUTBOUND' AND status<>'FAILED'`.
4. **Intencja przekazania idzie przez istniejący outbox**, w tej samej
   transakcji, co `CONFIRMED`. Payments nie importuje connectivity.
5. **Konflikt jest pokazywany, nie wchłaniany.** Rezerwacja zewnętrzna na
   nocach trzymanych przez potwierdzoną rezerwację albo żywy Hold tworzy
   blokadę i podnosi `EXTERNAL_RESERVATION_CONFLICT`.

---

## 2. Co zostało do zrobienia

### 2.1 Zablokowane dostępem partnerskim

#### Hostaway — konto u dostawcy

Potrzebne: konto Hostaway z dostępem do *Settings → Hostaway API* i wygenerowaną
parą **Account ID + API key**. Brak wymogu certyfikacji dla integracji
korzystającej z publicznego API.

Do zrobienia po zdobyciu konta:

```text
[ ] przejść manual flow §42 przeciwko api.hostaway.com zamiast dublera
[ ] zarejestrować webhook w Settings → Integrations → Webhooks
    (URL + login `rezervio` + hasło pokazane raz przy łączeniu)
[ ] sprawdzić odchylenia prawdziwego API od dokumentacji:
      - realny kształt payloadu webhooka (dokumentacja go nie podaje)
      - paginacja przy >200 listingach i >200 rezerwacjach
      - realne zachowanie rate limitów (200/10 s) i nagłówków X-RateLimit-*
      - czy `externalReservationId` faktycznie przyjmuje nasz publicReference
[ ] potwierdzić, że statusy spoza naszej mapy (`toReservationStatus`)
    nie pojawiają się w praktyce
```

#### Channex — dostęp partnerski

Kroki 1–2 są samoobsługowe i można je wykonać od razu. Krok 4 wymaga decyzji
budżetowej.

```text
[ ] 1. konto na staging.channex.io z testową property, pokojami i planami cenowymi
[ ] 2. utworzenie Open Channel w panelu Channex
[ ] 3. api-key i hotel_code → CHANNEX_INBOUND_API_KEY i CHANNEX_API_KEY
[ ] 4. certyfikacja: zmiany dostępności/cen/restrykcji, mapowanie, testowe
       rezerwacje. Podawana opłata: 300 USD rocznie, płatna PRZED certyfikacją
[ ] 5. wpis na listę kanałów Channex i produkcyjny secure.channex.io
```

Do zrobienia po zdobyciu dostępu:

```text
[ ] przejść manual flow §43 (ścieżka „access dostępny")
[ ] zweryfikować kształt payloadu new_booking na prawdziwym staging
    (kontrakt nie precyzuje odpowiedzi — dziś traktujemy 2xx jako potwierdzenie)
[ ] sprawdzić, jak Channex reaguje na read_only: true przy rate planach
[ ] zaimplementować dostarczanie rezerwacji Rezervio do Channexa w outbound
    (dziś OutboundReservationsService zwraca PROVIDER_NOT_PUSHABLE dla CHANNEX)
[ ] rekoncyliacja po stronie kanału — request_full_sync jest zaimplementowany,
    ale nie ma jeszcze przebiegu, który go używa
```

### 2.2 Niezależne od dostępu partnerskiego

#### Anulowanie potwierdzonej rezerwacji

Największa realna luka. `BookingsService.cancelBooking` odrzuca wszystko poza
`PENDING_HOST_APPROVAL` i `PENDING_PAYMENT`, więc **nie istnieje komenda, która
anuluje `CONFIRMED` Booking**. Ścieżka wychodzącego anulowania jest okablowana
i przetestowana (serwis + kolejka + dostawca), ale nic w produkcie do niej nie
prowadzi.

```text
[ ] zdecydować, kto i na jakich warunkach może anulować CONFIRMED
    (polityka anulowania, zwrot, cofnięcie Settlement — to jest milestone sam w sobie)
[ ] podpiąć istniejący EXTERNAL_RESERVATION_CANCEL do tej komendy
    — intencja jest już zapisywana w cancelBooking, więc wystarczy komenda
```

Pliki: `apps/api/src/modules/bookings/bookings.service.ts`,
`apps/api/src/modules/connectivity/application/outbound-reservations.service.ts`.

#### Rekoncyliacja rezerwacja po rezerwacji

`InventorySyncService.reconcileConnection` odpytuje `getReservation` dla każdej
aktywnej rezerwacji. Przy tysiącach rezerwacji na połączenie trzeba przejść na
porównanie listy (`listReservations` w oknie vs nasz stan).

```text
[ ] przepisać na porównanie zbiorów zamiast pętli po pojedynczych rezerwacjach
[ ] zachować obecne zachowanie: brak rezerwacji u dostawcy = zwolnienie terminu
```

Plik: `apps/api/src/modules/connectivity/application/inventory-sync.service.ts`.

#### Tożsamość zdarzenia Hostaway

Hostaway nie gwarantuje unikalnego identyfikatora dostawy, więc tożsamość
zdarzenia składamy z `connection:event:reservationId:id`. Dwie różne zmiany tej
samej rezerwacji w tej samej chwili mogłyby się zlać (wyłapuje to sweep, ale
z opóźnieniem).

```text
[ ] po zdobyciu konta sprawdzić, czy webhook niesie stabilny identyfikator
[ ] jeśli tak — użyć go zamiast składanki
```

Plik: `apps/api/src/modules/connectivity/webhooks/hostaway-webhook.controller.ts`.

#### Model hotelowy

Channex operuje na room types, rate plans i obłożeniu. Rezervio ma jeden
`Property` = jedna jednostka. Mapowanie to zawsze jeden room type z jednym rate
planem, `availability` 0 albo 1.

```text
[ ] jeśli kiedykolwiek pojawi się inventory hotelowe (room type, allotment,
    multi-room booking) — to osobny milestone i przepisanie tego mapowania
```

Świadomie poza zakresem, wpisane w `docs/project-state.md` → „Czego celowo nie ma".

#### Drobne

```text
[ ] provider-events: `applyKnown` jest publiczne, ale nieużywane w produkcji
    — zostawione pod przyszły przepływ, w którym payload jest autorytatywny
[ ] Host UI: brak ekranu „historia synchronizacji" poza pięcioma ostatnimi
    wpisami na karcie integracji
[ ] brak alertu, gdy połączenie jest DEGRADED dłużej niż X — dziś widać to
    tylko w /admin/operations
```

---

## 3. Jak wznowić

### Nowe pliki tego milestone

```text
apps/api/src/modules/connectivity/
  domain/            inventory-provider.ts, channel-provider.ts, provider-errors.ts
  infrastructure/    hostaway.provider.ts, channex.provider.ts,
                     provider-http.ts, credentials.cipher.ts
  application/       connections, mappings, inbound-reservations, outbound-reservations,
                     inventory-sync, provider-events, channex-changes,
                     provider-registry, external-sync.worker
  webhooks/          hostaway-webhook.controller.ts, channex-channel.controller.ts
  host-integrations.controller.ts

apps/api/tests/
  connectivity.integration.test.ts             (37)
  connectivity-concurrency.integration.test.ts  (5)
  connectivity-contract.test.ts                (16)
  channex-channel.integration.test.ts          (11)
  connectivity-admin.integration.test.ts       (15)

apps/web/
  app/host/(app)/integrations/{page,hostaway/page,[id]/page}.tsx
  app/admin/integrations/page.tsx
  components/host/{IntegrationCard,ConnectHostawayForm,PropertyMappingPanel}.tsx
  components/admin/IntegrationActions.tsx
  lib/integrations.ts
  tests/integrations.test.ts                    (5)

migracje: drizzle/0013_elite_nico_minoru.sql, drizzle/0014_secret_eddie_brock.sql
```

### Zmienne środowiskowe

Pełne opisy w `.env.example`, sekcja „Milestone 12".

```env
PROVIDER_CREDENTIALS_ENCRYPTION_KEY=   # gdy puste → ICAL_URL_ENCRYPTION_KEY
EXTERNAL_SYNC_INTERVAL_MINUTES=15
EXTERNAL_SYNC_HORIZON_DAYS=365
API_PUBLIC_URL=http://localhost:3001/api

HOSTAWAY_API_BASE_URL=https://api.hostaway.com
# HOSTAWAY_ALLOWED_HOSTS=hostaway.com     # nadpisanie allowlisty (tylko dev)

CHANNEX_INBOUND_API_KEY=   # klucz, którym Channex uwierzytelnia się u nas
CHANNEX_API_KEY=           # klucz, którym my dostarczamy rezerwacje
CHANNEX_API_BASE_URL=https://secure.channex.io
```

### Manual flow bez konta u dostawcy

Skrypty przebiegu żyły w katalogu tymczasowym sesji i **nie przetrwają**.
Dubler Hostaway jest odtworzony w załączniku poniżej — to jedyna rzecz, której
odtworzenie zajęłoby chwilę.

```bash
# 1. dubler
node /tmp/hostaway-double.mjs        # patrz załącznik A

# 2. API wskazane na dubler (allowlista musi wtedy dopuścić loopback)
HOSTAWAY_API_BASE_URL=http://127.0.0.1:4599 \
HOSTAWAY_ALLOWED_HOSTS=127.0.0.1 \
EXTERNAL_SYNC_INTERVAL_MINUTES=1 \
  node apps/api/dist/main.js

# 3. /host/integrations → Połącz Hostaway → accountId dowolny, apiKey dowolny
#    (dubler akceptuje każdy niepusty secret)
```

Loopback po HTTP jest dopuszczony wyłącznie poza produkcją —
`isAllowedProviderUrl` w `provider-http.ts` ignoruje ten wyjątek przy
`NODE_ENV=production`.

### Kontrakty dostawców — skąd pochodzą

Weryfikowane 2026-09-06, oba API osiągalne, oba zwracają `401` bez credentiali.

```text
Hostaway   https://api.hostaway.com/documentation
Channex    https://docs.channex.io/for-ota/open-channel-api
```

Cytaty ścieżek i nazw pól są w komentarzach adapterów. Przy wznawianiu warto
sprawdzić, czy dokumentacja się nie zmieniła — testy kontraktowe wychwycą
rozjazd tylko wtedy, gdy zaktualizuje się też dubler.

---

## Załącznik A — dubler Hostaway

Kształtowany opublikowanym kontraktem; adapter pod testem jest prawdziwy
i niezmodyfikowany. Zapisz jako `hostaway-double.mjs` i uruchom
`node hostaway-double.mjs`.

```js
import { createServer } from "node:http";

const state = {
  listings: [
    { id: 101, name: "Apartament Milestone 12", internalListingName: "Apartament Milestone 12", address: "ul. Testowa 1, Gdańsk" },
    { id: 102, name: "Inny listing", internalListingName: "Inny listing", address: null },
  ],
  reservations: new Map(),
  created: [],
  cancelled: [],
  nextId: 5000,
};

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;

    // Sterowanie przebiegiem — nie jest częścią kontraktu Hostaway.
    if (path === "/__control/reservation" && request.method === "POST") {
      const reservation = JSON.parse(body);
      state.reservations.set(String(reservation.id), reservation);
      return json(response, 200, { ok: true });
    }
    if (path === "/__control/reservation" && request.method === "DELETE") {
      state.reservations.delete(String(url.searchParams.get("id")));
      return json(response, 200, { ok: true });
    }
    if (path === "/__control/state") {
      return json(response, 200, {
        reservations: [...state.reservations.values()],
        created: state.created,
        cancelled: state.cancelled,
      });
    }

    if (path === "/v1/accessTokens" && request.method === "POST") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") !== "client_credentials" || !form.get("client_secret")) {
        return json(response, 401, { message: "bad credentials" });
      }
      return json(response, 200, {
        access_token: "double-token",
        token_type: "Bearer",
        expires_in: 63072000,
      });
    }

    if (!String(request.headers.authorization ?? "").startsWith("Bearer ")) {
      return json(response, 401, { message: "missing bearer" });
    }

    if (path === "/v1/listings") {
      return json(response, 200, { status: "success", result: state.listings });
    }

    if (path === "/v1/reservations" && request.method === "GET") {
      const listingId = url.searchParams.get("listingId");
      const result = [...state.reservations.values()].filter(
        (row) => String(row.listingMapId) === listingId,
      );
      return json(response, 200, { status: "success", result });
    }

    if (path === "/v1/reservations" && request.method === "POST") {
      const payload = JSON.parse(body);
      const id = (state.nextId += 1);
      state.created.push(payload);
      state.reservations.set(String(id), {
        id,
        listingMapId: payload.listingMapId,
        arrivalDate: payload.arrivalDate,
        departureDate: payload.departureDate,
        status: "accepted",
        guestName: payload.guestName,
        numberOfGuests: payload.numberOfGuests,
        channelName: "direct",
      });
      return json(response, 200, { status: "success", result: { id } });
    }

    const single = /^\/v1\/reservations\/(.+)$/.exec(path);
    if (single) {
      const id = decodeURIComponent(single[1]);

      if (request.method === "DELETE") {
        if (!state.reservations.has(id)) return json(response, 404, { message: "not found" });
        state.cancelled.push(id);
        state.reservations.set(id, { ...state.reservations.get(id), status: "cancelled" });
        return json(response, 200, { status: "success" });
      }

      const row = state.reservations.get(id);
      if (!row) return json(response, 404, { message: "not found" });
      return json(response, 200, { status: "success", result: row });
    }

    json(response, 404, { message: "not found" });
  });
});

server.listen(4599, "127.0.0.1", () => {
  console.log("hostaway double on http://127.0.0.1:4599");
});
```

## Załącznik B — kroki manual flow §42, które przeszły

Przeciwko dublerowi z załącznika A, z prawdziwą płatnością w sandboxie Stripe
po stronie Rezervio.

```text
 1. Connect Hostaway                     status CONNECTED, klucz zapisany jako v1.…
 2. Fetch external properties            2 listingi, propozycja po dokładnej nazwie
 3. Map one Property                     potwierdzone przez Hosta
 4. Sync                                 zadanie w kolejce, nie w wątku żądania
 5. Create external reservation          4001, 2035-03-10 → 2035-03-15
 6. Verify EXTERNAL_PROVIDER block       blokada jest, POST /api/bookings → 409
 7. Cancel external reservation          usunięta u dostawcy, webhook nie dociera
 8. Verify reconciliation                „sprawdzone 1, zwolnione 1", blokada znika
 9. Create + confirm Rezervio Booking    RZV-…, CONFIRMED, intencja w outboxie
10. Verify outbound reservation          5001 u dostawcy, 2035-05-10 → 2035-05-14
11. Cancel Rezervio Booking              zadanie kolejki (patrz 2.2 — brak komendy)
12. Verify outbound cancellation         dostawca: 5001 cancelled
13. Replay duplicates                    webhook ×3 → duplicate: false, true, true
14. Verify no duplicate effects          1 blokada, 1 mapowanie, 1 zdarzenie;
                                         retry push ×2 → 1 rezerwacja u dostawcy
```
