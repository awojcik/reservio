# Rezervio — MVP v0.1: Search Experience

## 1. Cel

Zbuduj pierwszą działającą wersję aplikacji **Rezervio** — marketplace'u rezerwacji apartamentów i domów wakacyjnych.

Rezervio ma być alternatywą dla dużych OTA. Główne założenie biznesowe:

> Hosts pay less. Guests pay less.

Na tym etapie NIE budujemy backendu, logowania, płatności ani prawdziwych rezerwacji.

Chcemy stworzyć **wysokiej jakości, działający frontend MVP**, który:

- można uruchomić lokalnie;
- wygląda jak prawdziwy produkt, nie prototyp developerski;
- pozwala wyszukiwać apartamenty;
- posiada działającą mapę;
- posiada działające filtry;
- pozwala przejść na kartę apartamentu;
- jest responsywny;
- ma charakterystyczny, własny design;
- będzie później łatwo podłączyć do backendowego API.

Najważniejszym ekranem jest:

**lista ofert + mapa**, podobnie funkcjonalnie do marketplace'ów typu JustJoin, ale NIE kopiuj ich designu.

---

# 2. Zasady implementacji

Nie pytaj o dodatkowe decyzje techniczne, jeśli można rozsądnie podjąć je samodzielnie.

Priorytety:

1. działająca aplikacja;
2. bardzo dobry UX;
3. bardzo wysoka czytelność;
4. charakterystyczny design;
5. prosty kod;
6. możliwość dalszego rozwoju.

Nie over-engineeruj rozwiązania.

Nie twórz mikroserwisów.

Nie buduj backendu.

Nie dodawaj funkcji spoza zakresu.

---

# 3. Stack

Użyj:

- Next.js App Router
- TypeScript
- React
- Tailwind CSS v4
- MapLibre GL JS
- OpenFreeMap do developmentowej mapy
- Lucide React dla ikon
- date-fns
- pnpm

Używaj najnowszej stabilnej, security-patched wersji Next.js dostępnej w momencie implementacji.

Nie używaj gotowego domyślnego wyglądu shadcn.

Jeśli potrzebujesz prostych primitives typu Dialog/Popover, możesz użyć Radix UI, ale cały styling ma być własny.

---

# 4. Struktura projektu

Stwórz:

```text
rezervio/
├── app/
│   ├── page.tsx
│   ├── search/
│   │   └── page.tsx
│   ├── property/
│   │   └── [id]/
│   │       └── page.tsx
│   ├── layout.tsx
│   └── globals.css
│
├── components/
│   ├── layout/
│   ├── search/
│   ├── property/
│   ├── map/
│   └── ui/
│
├── data/
│   └── properties.ts
│
├── lib/
│   ├── search.ts
│   ├── format.ts
│   └── types.ts
│
├── public/
└── README.md
```

Architektura komponentów powinna pozwalać później zastąpić mockowane dane requestami do REST API.

---

# 5. Design direction

Rezervio NIE może wyglądać jak:

- Booking.com;
- Airbnb;
- standardowy niebieski SaaS;
- generyczny Tailwind/shadcn dashboard.

Design powinien być:

**travel-tech + editorial + premium + extremely readable**

Inspiracja stylistyczna:

- dużo whitespace;
- zwarte karty;
- mocna typografia;
- mała liczba kolorów;
- brak gradientów;
- minimalne cienie;
- mocne, charakterystyczne akcenty;
- wysoki kontrast.

## Kolory

Zaimplementuj poniższe design tokens:

```css
--background: #F5F1E8;
--surface: #FFFCF6;

--text-primary: #18221D;
--text-secondary: #6E756F;

--brand: #123C32;
--accent: #FF5B45;
--highlight: #D9FF66;

--border: #DCD8CD;
--success: #197A5A;
```

Znaczenie:

### Deep Pine `#123C32`

Główny kolor marki.

Użycie:

- CTA;
- aktywne elementy;
- logo;
- selected states.

### Coral `#FF5B45`

Kolor discovery.

Użycie:

- pinezki mapy;
- małe akcenty;
- aktywne filtry;
- hover.

Nie używaj białego tekstu na coral.

Używaj:

```text
#18221D
```

### Acid Lime `#D9FF66`

Najbardziej charakterystyczny element marki.

Użycie WYŁĄCZNIE:

- oszczędność;
- "Good deal";
- "Fair price";
- specjalne badge.

Przykład:

```text
SAVE €84
```

Nie używaj lime jako głównego CTA.

### Background

Warm/off-white zamiast czystej bieli.

To ma odróżniać Rezervio od innych portali.

---

# 6. Typografia

Użyj:

**Manrope**

przez `next/font`.

Typografia:

```text
Hero:        56–64px / 700
H1:          36–44px / 700
H2:          24–28px / 700
Card title:  17–18px / 700
Body:        15–16px / 400–500
Small:       13–14px / 500
```

Używaj raczej:

```text
letter-spacing: -0.02em
```

dla dużych nagłówków.

Nie używaj bardzo cienkich fontów.

---

# 7. Logo

Na tym etapie nie potrzebujemy SVG logo.

Zrób prosty wordmark:

```text
rezervio°
```

lowercase.

`rezervio` w `#123C32`.

Mały znak `°` w `#FF5B45`.

Font weight 750/800.

Logo powinno być bardzo proste i charakterystyczne.

Nie używaj ikon:

- samolotu;
- palmy;
- globusa;
- walizki.

---

# 8. Desktop layout

Najważniejszy ekran:

```text
/search
```

Przy szerokości >= 1100 px:

```text
┌──────────────────────────────────────────────────────┐
│ Header                                               │
├──────────────────────────────────────────────────────┤
│ Search controls                                      │
├──────────────────────────────┬───────────────────────┤
│                              │                       │
│ RESULTS                      │                       │
│                              │        MAP            │
│ scroll independently         │                       │
│                              │        sticky         │
│                              │                       │
└──────────────────────────────┴───────────────────────┘
```

Proporcje:

```text
results: 58%
map:     42%
```

Mapa pozostaje widoczna podczas scrollowania wyników.

---

# 9. Header

Desktop:

```text
rezervio°                Dla gospodarzy    Zaloguj się
```

Wysokość:

```text
72px
```

Border-bottom subtelny.

Brak dużej nawigacji.

CTA "Dla gospodarzy" może być outline.

"Zaloguj się" plain text button.

Nie implementuj logowania.

---

# 10. Search bar

Pod headerem:

```text
┌───────────────────────────────────────────────────────────────┐
│ 📍 Gdańsk  │  12 wrz — 16 wrz  │  2 dorosłych, 2 dzieci │ 🔍 │
└───────────────────────────────────────────────────────────────┘
```

Search bar ma wyglądać bardziej jak nowoczesny command bar niż formularz.

Elementy:

### Destination

input.

Default:

```text
Gdańsk
```

### Dates

na MVP prosty popover.

Nie potrzebujemy pełnego skomplikowanego date pickera.

### Guests

popover:

```text
Adults     - 2 +
Children   - 2 +
```

### Search

button w kolorze brand:

```text
#123C32
```

---

# 11. AI search placeholder

Pod głównym search barem dodaj bardzo subtelny element:

```text
✦ Opisz czego szukasz
```

Po kliknięciu rozwija się input:

```text
Rodzina 2+2, blisko plaży, parking i basen, do 3000 zł...
```

Na tym etapie NIE podłączaj LLM.

Po Submit zaimplementuj prostą demonstracyjną interpretację kilku keywords:

```text
"basen" → pool=true
"parking" → parking=true
"plaża" → beachDistance <= 500
```

Ma to demonstrować późniejszy kierunek produktu.

---

# 12. Filter bar

Pod search barem:

```text
[ Cena ]
[ Typ obiektu ]
[ Sypialnie ]
[ Basen ]
[ Parking ]
[ Plaża ]
[ Ocena ]
[ Więcej filtrów ]
```

Filtry mają być chips/pills.

Nie rób wielkiego sidebara.

Active filter:

- coral border;
- lekkie coral background;
- dark text.

Filtry muszą faktycznie filtrować mockowane dane.

---

# 13. Results header

Nad listą:

```text
218 miejsc w Gdańsku

                    Sortuj: Najlepsze
```

Dla mockowanych danych pokazuj rzeczywistą liczbę wyników.

Sortowanie:

- Polecane
- Najniższa cena
- Najwyższa ocena
- Najbliżej plaży
- Best value

---

# 14. Property Card

Karta ma być zwarta.

Desktop:

```text
┌─────────────────────────────────────────────────────┐
│ ┌───────────────┐                                   │
│ │               │  Baltic Loft                     │
│ │     PHOTO     │  ★ 9.4 · Gdańsk, Brzeźno        │
│ │               │                                  │
│ │               │  2 sypialnie · 4 osoby          │
│ └───────────────┘  Basen · Parking · 280m plaża   │
│                                                     │
│                    1 920 zł                         │
│                    4 noce · cena całkowita         │
│                                                     │
│                    [ OSZCZĘDZASZ 180 ZŁ ]           │
└─────────────────────────────────────────────────────┘
```

Każda karta:

- zdjęcie;
- title;
- neighborhood;
- rating;
- bedrooms;
- max guests;
- 3 najważniejsze amenities;
- distance to beach jeżeli dostępne;
- TOTAL PRICE;
- liczba nocy;
- badge saving.

### Bardzo ważne

Najważniejszą ceną jest:

```text
1 920 zł
```

Nie:

```text
480 zł / noc
```

Pod ceną:

```text
4 noce · cena całkowita
```

To jest ważny element marki Rezervio.

---

# 15. Saving badge

Jeżeli property posiada:

```typescript
marketPrice > totalPrice
```

pokazuj:

```text
OSZCZĘDZASZ 180 ZŁ
```

Background:

```text
#D9FF66
```

Text:

```text
#18221D
```

Ma wyglądać jak charakterystyczny element Rezervio.

---

# 16. Card interactions

Hover:

- bardzo delikatny `translateY(-1px)`;
- border zmienia się na brand;
- brak dużego shadow.

Selected:

```text
border: #123C32
```

oraz mały coral indicator.

Kliknięcie karty:

```text
/property/{id}
```

Heart icon:

local favorite state.

Nie potrzebujemy backendu.

---

# 17. Mapa

Użyj:

**MapLibre GL JS**

oraz developmentowo OpenFreeMap.

Preferowany styl:

```text
Positron
```

lub najbardziej neutralny jasny styl dostępny w OpenFreeMap.

Mapa ma być wizualnie spokojna.

Nie powinna konkurować z ofertami.

Center dla demo:

```text
Gdańsk
```

Mockowane properties rozmieść realistycznie:

- Gdańsk Śródmieście;
- Brzeźno;
- Jelitkowo;
- Wrzeszcz;
- Oliwa;
- Sopot.

---

# 18. Map markers

Marker nie jest zwykłą pinezką.

Pokazuj cenę:

```text
480 zł
```

Default:

```text
background: #FF5B45
text: #18221D
```

Selected:

```text
background: #123C32
color: white
```

Marker powinien mieć:

- rounded rectangle;
- 30–36 px height;
- lekki border;
- minimalny shadow.

---

# 19. Synchronizacja lista ↔ mapa

To MUSI działać.

### Hover card

podświetla odpowiedni marker.

### Click marker

- ustawia selected property;
- przewija corresponding card do widoku.

### Click card

- selected marker;
- opcjonalnie lekkie pan map do lokalizacji.

To jest jedna z najważniejszych interakcji całego MVP.

---

# 20. Search this area

Po przesunięciu mapy pokaż button:

```text
Szukaj w tym obszarze
```

Na MVP button może filtrować properties według aktualnego viewport bounds.

Jeżeli implementacja byłaby zbyt kosztowna, minimum:

- wykryj `moveend`;
- pokaż przycisk;
- kliknięcie powoduje ponowne przefiltrowanie danych znajdujących się w bounds mapy.

---

# 21. Mock data

Przygotuj minimum:

```text
18 properties
```

Każdy:

```typescript
type Property = {
  id: string
  slug: string
  title: string

  city: string
  district: string

  latitude: number
  longitude: number

  images: string[]

  rating: number
  reviewCount: number

  bedrooms: number
  beds: number
  bathrooms: number
  maxGuests: number

  amenities: string[]

  distanceToBeach?: number

  pricePerNight: number
  cleaningFee: number

  marketPrice: number

  propertyType:
    | "apartment"
    | "house"
    | "villa"
    | "studio"

  description: string
}
```

Stwórz funkcję:

```typescript
calculateTotalPrice(property, checkIn, checkOut)
```

Zwracającą:

```typescript
{
  nights,
  accommodationPrice,
  cleaningFee,
  totalPrice,
  saving
}
```

Dane mają wyglądać realistycznie.

---

# 22. Zdjęcia

Użyj dobrych jakościowo zdjęć apartamentów.

Możesz użyć stabilnych URL zdjęć z Unsplash dla demo.

Skonfiguruj `next/image`.

Jeśli obraz się nie załaduje:

- pokaż estetyczny local fallback;
- karta nie może się rozsypać.

Aspect ratio:

```text
4:3
```

---

# 23. Property detail page

Route:

```text
/property/[id]
```

Nie musi być jeszcze bardzo rozbudowana.

Ma zawierać:

## Gallery

duże zdjęcie + 4 mniejsze.

## Header

```text
Baltic Loft

★ 9.4 · 127 opinii
Gdańsk, Brzeźno
```

## Key information

```text
4 gości
2 sypialnie
2 łóżka
1 łazienka
```

## Amenities

6–10 najważniejszych.

## Description

krótki.

## Mini map

lokalizacja property.

## Sticky booking card

Desktop, prawa kolumna:

```text
12 — 16 września
2 dorosłych · 2 dzieci

Noclegi           1 800 zł
Sprzątanie          120 zł
──────────────────────────
RAZEM             1 920 zł

OSZCZĘDZASZ 180 ZŁ

[ Zarezerwuj ]
```

Button nie wykonuje prawdziwego booking.

Po kliknięciu pokaż toast:

```text
Rezerwacje online pojawią się w kolejnym etapie MVP.
```

---

# 24. Homepage

Route:

```text
/
```

Ma być bardzo prosty.

Nie buduj ogromnego marketingowego landing page.

Above the fold:

```text
rezervio°

Podróżuj więcej.
Płać mniej za nocleg.

[ Gdzie jedziesz? ]
[ Kiedy? ]
[ Goście ]
[ Szukaj ]
```

Pod spodem:

```text
Hosts pay less.
You pay less.
```

3 krótkie benefits:

```text
Cena całkowita od początku

Zweryfikowani gospodarze

Niższe opłaty dla gospodarzy
```

Dalej:

```text
Popularne teraz
```

3–4 destination cards:

- Gdańsk
- Sopot
- Kraków
- Zakopane

Kliknięcie Gdańska prowadzi do:

```text
/search?destination=Gdansk
```

---

# 25. Mobile

Poniżej:

```text
1024px
```

nie pokazuj mapy i listy jednocześnie.

Default:

### LIST VIEW

Na dole floating button:

```text
[ 🗺 Mapa ]
```

Kliknięcie:

pełnoekranowa mapa.

Na mapie:

```text
[ ☰ Lista ]
```

Filter bar:

horizontal scroll.

`Więcej filtrów` otwiera bottom sheet / drawer.

Search bar ma się skompresować.

---

# 26. URL state

Filtry i wyszukiwanie powinny być reprezentowane w query params.

Przykład:

```text
/search?
destination=Gdansk
&adults=2
&children=2
&pool=true
&parking=true
&maxPrice=2500
```

Odświeżenie strony nie powinno resetować filtrów.

---

# 27. Accessibility

Wymagane:

- pełna obsługa keyboard;
- visible focus;
- aria-label dla icon buttons;
- semantyczny HTML;
- minimum WCAG AA contrast;
- buttons minimum 44px touch target na mobile;
- respektuj `prefers-reduced-motion`.

Nie opieraj znaczenia wyłącznie na kolorze.

---

# 28. Performance

Target:

- brak dużych layout shifts;
- lazy loading images;
- mapa lazy-loaded client-side;
- dynamic import MapLibre;
- nie renderuj mapy SSR;
- minimalizuj unnecessary client components.

Next.js Server Components tam, gdzie mają sens.

Search/filter/map interactions mogą być client components.

---

# 29. Error / empty states

Zaimplementuj:

### No results

```text
Nie znaleźliśmy takich miejsc.

Spróbuj zmienić termin albo usunąć część filtrów.
```

Button:

```text
Wyczyść filtry
```

### Broken image

fallback.

### Map unavailable

lista nadal musi działać.

---

# 30. README

README ma zawierać:

```bash
pnpm install
pnpm dev
```

oraz:

```text
http://localhost:3000
```

Opisz:

- stack;
- strukturę;
- sposób dodania nowych properties;
- design tokens;
- jak później zastąpić mock data przez API.

---

# 31. Scripts

Projekt musi posiadać:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
```

Wszystkie muszą działać bez błędów.

---

# 32. Tests

Dodaj minimum kilka testów dla logiki:

```text
calculateTotalPrice
filterProperties
sortProperties
```

Nie trzeba testować każdego komponentu.

---

# 33. Definition of Done

Projekt jest gotowy dopiero jeśli:

- `pnpm install` działa;
- `pnpm dev` uruchamia aplikację;
- `pnpm build` przechodzi;
- TypeScript nie ma błędów;
- homepage działa;
- search page działa;
- detail page działa;
- mapa działa;
- markery działają;
- card → marker highlighting działa;
- marker → card highlighting działa;
- filtry faktycznie zmieniają wyniki;
- sortowanie działa;
- URL przechowuje filtry;
- mobile list/map switch działa;
- design jest spójny;
- aplikacja nie wygląda jak domyślny Tailwind/shadcn;
- nie ma placeholderowego lorem ipsum;
- mockowane dane wyglądają realistycznie.

---

# 34. Ważne decyzje UX

Trzy najważniejsze elementy Rezervio:

## 1. Map-first discovery

Mapa jest integralną częścią wyszukiwania.

## 2. Total price first

Najważniejszą ceną jest:

```text
1 920 zł za cały pobyt
```

a nie:

```text
480 zł / noc
```

## 3. Fair price

Oszczędność jest elementem produktu:

```text
OSZCZĘDZASZ 180 ZŁ
```

i ma charakterystyczny lime badge.

---

# 35. Czego NIE robić

Nie używaj:

- niebieskiego jako głównego koloru;
- purple gradientów;
- glassmorphism;
- wielkich shadows;
- ogromnych border radius typu 32px wszędzie;
- generycznych dashboard cards;
- stockowego wyglądu shadcn;
- animacji dla samej animacji;
- emoji jako ikon interfejsu;
- logo z samolotem;
- Booking.com-like layoutu;
- Airbnb-like layoutu.

Design ma mieć własną osobowość.

---

# 36. Ostateczny efekt

Po uruchomieniu:

```bash
pnpm dev
```

użytkownik powinien móc:

```text
localhost:3000
        ↓
wyszukać Gdańsk
        ↓
zobaczyć listę + mapę
        ↓
filtrować
        ↓
najechać ofertę
        ↓
zobaczyć odpowiadającą pinezkę
        ↓
kliknąć pinezkę
        ↓
zobaczyć ofertę
        ↓
wejść w szczegóły
        ↓
zobaczyć pełną cenę
        ↓
kliknąć "Zarezerwuj"
```

Aplikacja ma wyglądać wystarczająco dobrze, żeby można było zrobić screenshot i pokazać go potencjalnemu gospodarzowi jako wizję produktu.

Po zakończeniu implementacji:

1. uruchom lint;
2. uruchom typecheck;
3. uruchom testy;
4. uruchom production build;
5. napraw wszystkie błędy;
6. wypisz krótko, co zostało zaimplementowane;
7. podaj komendę uruchomienia;
8. wypisz maksymalnie 5 rzeczy, które rekomendujesz jako następny etap.

Nie kończ pracy, dopóki production build nie przechodzi.