# rezervio°

Marketplace noclegów, w którym **cena całkowita** jest widoczna od pierwszego ekranu,
a oszczędność względem dużych OTA jest częścią produktu, nie promocją.

> Hosts pay less. Guests pay less.

To jest **MVP v0.1 — Search Experience**: działający frontend bez backendu, logowania,
płatności i prawdziwych rezerwacji. Dane są mockowane, ale architektura jest
przygotowana pod podmianę na REST API.

## Uruchomienie

```bash
pnpm install
pnpm dev
```

Aplikacja startuje pod adresem:

```
http://localhost:3000
```

Wymagany Node 20+ oraz pnpm 9+.

## Skrypty

| Komenda          | Opis                                        |
| ---------------- | ------------------------------------------- |
| `pnpm dev`       | serwer deweloperski                         |
| `pnpm build`     | produkcyjny build                           |
| `pnpm start`     | uruchomienie zbudowanej aplikacji           |
| `pnpm lint`      | ESLint (konfiguracja Next.js + TypeScript)  |
| `pnpm typecheck` | `tsc --noEmit`                              |
| `pnpm test`      | testy logiki wyszukiwania i cen (Vitest)    |

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **TypeScript** (strict)
- **Tailwind CSS v4** — tokeny w `app/globals.css`, bez gotowych motywów
- **MapLibre GL JS** + **OpenFreeMap** (styl Positron) — mapa i markery
- **Radix UI** (Popover, Dialog) — wyłącznie jako primitives, cały styling własny
- **lucide-react** — ikony
- **date-fns** — daty i lokalizacja `pl`
- **Vitest** — testy jednostkowe

## Struktura

```text
app/
  page.tsx               strona główna (Server Component)
  search/page.tsx        wyniki + mapa (Suspense → client)
  property/[id]/page.tsx karta obiektu (Server Component)
  layout.tsx, globals.css

components/
  layout/     Header, Logo
  search/     SearchBar, DatesPopover, GuestsPopover, FilterBar,
              AiSearchField, ResultsHeader, EmptyState, SearchExperience
  property/   PropertyCard, Gallery, BookingCard, SavingBadge, Rating,
              PropertyLocation, useFavorites
  map/        PropertyMap (lista ↔ mapa), MiniMap, mapStyle
  ui/         Button, Chip, Checkbox, Popover, Dialog, Stepper, Toast,
              ImageWithFallback

data/
  properties.ts          20 mockowanych obiektów + akcesory

lib/
  types.ts               Property, SearchQuery, PriceBreakdown, ...
  search.ts              parsowanie URL, filterProperties, sortProperties
  pricing.ts             calculateTotalPrice
  format.ts              ceny, daty, polska odmiana rzeczowników
  nlq.ts                 demonstracyjna interpretacja opisu (bez LLM)

tests/                   pricing, search, nlq
```

`SearchExperience` jest jedynym komponentem trzymającym stan wyszukiwania. Źródłem
prawdy są **query params** — odświeżenie strony nie resetuje filtrów.

## Design tokens

Zdefiniowane w `app/globals.css` jako zmienne CSS i wystawione do Tailwinda
(`bg-surface`, `text-muted`, `border-line`, `bg-highlight`, ...).

| Token            | Wartość   | Zastosowanie                                   |
| ---------------- | --------- | ---------------------------------------------- |
| `--background`   | `#F5F1E8` | ciepłe tło całej aplikacji (zamiast bieli)     |
| `--surface`      | `#FFFCF6` | karty, pola formularzy, header                 |
| `--text-primary` | `#18221D` | tekst podstawowy                               |
| `--text-secondary` | `#6E756F` | tekst pomocniczy                             |
| `--brand`        | `#123C32` | Deep Pine — CTA, stany aktywne, logo           |
| `--accent`       | `#FF5B45` | Coral — pinezki, aktywne filtry, akcenty       |
| `--highlight`    | `#D9FF66` | Acid Lime — **wyłącznie** badge oszczędności   |
| `--border`       | `#DCD8CD` | delikatne obramowania                          |
| `--success`      | `#197A5A` | stany pozytywne                                |

Zasady: brak gradientów, minimalne cienie, wysoki kontrast, typografia **Manrope**
(`next/font`) z `letter-spacing: -0.02em` dla dużych nagłówków. Na coralu nigdy
nie używamy białego tekstu — tylko `#18221D`.

## Dodanie nowego obiektu

1. Dopisz rekord do `PROPERTIES` w `data/properties.ts` (typ `Property` z `lib/types.ts`).
2. Ustaw realne `latitude` / `longitude` — obiekt od razu pojawi się na mapie.
3. `pricePerNight` to cena Rezervio, `marketPrice` to średnia cena tej samej oferty
   na dużych portalach. Różnica napędza badge `OSZCZĘDZASZ …`.
4. `distanceToBeach` (w metrach) jest opcjonalne; filtr „Plaża" oznacza ≤ 500 m.
5. Zdjęcia: dowolne stabilne URL-e (host trzeba dodać do `images.remotePatterns`
   w `next.config.ts`). Gdy zdjęcie się nie załaduje, `ImageWithFallback` pokazuje
   lokalny placeholder i karta się nie rozjeżdża.

## Podmiana mock danych na API

Cała warstwa danych schodzi się w dwóch miejscach:

```ts
// data/properties.ts
export function getProperties(): Property[]
export function getPropertyById(id: string): Property | undefined
```

Ścieżka migracji:

1. Zamień powyższe funkcje na `async` z `fetch()` do swojego REST API
   (kontrakt = typ `Property`).
2. Strony serwerowe (`app/page.tsx`, `app/property/[id]/page.tsx`) wystarczy
   `await`-ować — są już Server Components.
3. Dla `/search` przenieś filtrowanie na serwer: `filterProperties` /
   `sortProperties` z `lib/search.ts` przyjmują tablicę i `SearchQuery`, więc ta
   sama logika działa w route handlerze. `SearchExperience` wtedy tylko
   konsumuje wyniki — `parseSearchQuery(searchParams)` już zwraca gotowe
   parametry zapytania do API.
4. `calculateTotalPrice` przenieś na backend, gdy pojawi się kalendarz
   dostępności i ceny sezonowe; kształt `PriceBreakdown` może zostać bez zmian.

## Zakres MVP

Działa: wyszukiwanie, filtry (faktycznie filtrujące), sortowanie, stan w URL,
mapa z cenowymi markerami, synchronizacja lista ↔ mapa (hover, klik, przewijanie
do karty), „Szukaj w tym obszarze", widok mobilny lista/mapa, ulubione (localStorage),
karta obiektu z mini mapą i kartą rezerwacji.

Świadomie poza zakresem: backend, konta, płatności, prawdziwe rezerwacje,
LLM w wyszukiwarce (`lib/nlq.ts` to demonstracja kierunku na słowach kluczowych).
