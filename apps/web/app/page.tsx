import { ArrowUpRight, ReceiptText, ShieldCheck, TrendingDown } from "lucide-react";
import Link from "next/link";

import { HomeSearch } from "@/components/home/HomeSearch";
import { Header } from "@/components/layout/Header";
import { Logo } from "@/components/layout/Logo";
import { formatAmountMinor, formatResultCount } from "@/lib/format";
import { createServerApiClient } from "@/lib/api-server";

const BENEFITS = [
  {
    icon: ReceiptText,
    title: "Cena całkowita od początku",
    body: "Sprzątanie i opłaty widzisz w pierwszym wyniku wyszukiwania, nie w podsumowaniu płatności.",
  },
  {
    icon: ShieldCheck,
    title: "Zweryfikowani gospodarze",
    body: "Każdy obiekt ma potwierdzonego właściciela i realne opinie gości po pobycie.",
  },
  {
    icon: TrendingDown,
    title: "Niższe opłaty dla gospodarzy",
    body: "Prowizja jest kilkukrotnie niższa niż w dużych OTA — dlatego ta sama oferta kosztuje mniej.",
  },
];

/** Every city we have inventory for; counts and prices come from the API. */
const DESTINATIONS = [
  { name: "Gdańsk", query: "Gdansk", note: "Brzeźno, Jelitkowo, Oliwa, Wrzeszcz" },
  { name: "Sopot", query: "Sopot", note: "Dolny i Górny Sopot, Karlikowo" },
  { name: "Kraków", query: "Krakow", note: "Stare Miasto, Kazimierz, Podgórze" },
  { name: "Zakopane", query: "Zakopane", note: "Centrum, Kościelisko, Harenda" },
];

type DestinationStat = (typeof DESTINATIONS)[number] & {
  count: number;
  cheapestAmountMinor: number | null;
};

/**
 * Counts and starting prices come from the same search API the results page
 * uses — the homepage holds no catalogue of its own. If the API is down the
 * cards still render, just without numbers: a marketing page should not fail
 * because of it, and nothing here silently falls back to mock data.
 */
async function loadDestinationStats(): Promise<DestinationStat[]> {
  const api = createServerApiClient();

  return Promise.all(
    DESTINATIONS.map(async (destination) => {
      try {
        const response = await api.searchProperties(
          /*
           * No dates: the tile shows how many Properties a destination has and
           * what the cheapest one starts at, not a quote for a particular
           * stay. Pinning a demo week here would make those numbers wrong for
           * every visitor who is not travelling that week (§4).
           */
          {
            destination: destination.query,
            adults: 1,
            children: 0,
            sort: "LOWEST_PRICE",
          },
          { revalidate: 300 },
        );

        return {
          ...destination,
          count: response.total,
          cheapestAmountMinor: response.items[0]?.price.totalAmountMinor ?? null,
        };
      } catch {
        return { ...destination, count: 0, cheapestAmountMinor: null };
      }
    }),
  );
}

export default async function HomePage() {
  const stats = await loadDestinationStats();

  return (
    <>
      <Header />

      <main>
        {/*
          The brand moment, kept deliberately shallow: with the deep pine header
          above it, a taller band would tip the page past the warm-neutral
          balance. The search form below rises into it, so the boundary reads as
          composed rather than stacked.
        */}
        <section className="bg-brand text-surface">
          <div className="mx-auto max-w-[1120px] px-4 pt-12 pb-14 sm:px-6 sm:pt-14 lg:pt-16">
            <Logo size={30} asLink={false} onDark className="mb-7" />

            <h1 className="max-w-[16ch] text-[40px] leading-[1.02] font-bold tracking-tightest sm:text-[56px] lg:text-[64px]">
              Podróżuj więcej.
              <br />
              Płać mniej za nocleg.
            </h1>

            <p className="mt-5 max-w-[52ch] text-[16px] text-surface/80">
              Apartamenty i domy wakacyjne z ceną całkowitą pokazaną od pierwszego
              ekranu. Bez dopłat odkrywanych na końcu rezerwacji.
            </p>
          </div>
        </section>

        <div className="mx-auto -mt-8 mb-8 max-w-[1120px] px-4 sm:px-6">
          <HomeSearch />
        </div>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16">
            <p className="text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
              Hosts pay less.
              <br />
              <span className="text-brand">You pay less.</span>
            </p>

            <ul className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
              {BENEFITS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="border-t border-line pt-5">
                  <Icon size={20} strokeWidth={2.2} className="text-accent" />
                  <h2 className="mt-3 text-[17px] font-bold">{title}</h2>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-[24px] font-bold tracking-tight sm:text-[28px]">
              Popularne teraz
            </h2>
            <p className="text-[13px] font-semibold text-muted">
              ceny za 4 noce, 12—16 września
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((destination) => (
              <Link
                key={destination.name}
                href={`/search?destination=${destination.query}`}
                className="group flex min-h-[168px] flex-col justify-between rounded-[14px] border border-line bg-surface p-5 transition-colors hover:border-brand"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[22px] font-bold tracking-tight">
                    {destination.name}
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2.4}
                    aria-hidden="true"
                    className="text-muted transition-colors group-hover:text-accent"
                  />
                </div>

                <div>
                  <p className="text-[13px] text-muted">{destination.note}</p>
                  <p className="mt-3 text-[14px] font-bold">
                    {destination.cheapestAmountMinor === null
                      ? "Zobacz oferty"
                      : `${formatResultCount(destination.count)} · od ${formatAmountMinor(
                          destination.cheapestAmountMinor,
                        )}`}
                  </p>
                </div>
              </Link>
            ))}

          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-8 sm:px-6">
          <Logo size={17} />
          <p className="text-[13px] text-muted">
            MVP v0.1 · dane demonstracyjne, rezerwacje offline
          </p>
        </div>
      </footer>
    </>
  );
}
