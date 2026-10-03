import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { TripCard } from "@/components/account/TripCard";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Moje podróże" };

const CATEGORIES = [
  { value: "", label: "Wszystkie" },
  { value: "PENDING", label: "Oczekujące" },
  { value: "UPCOMING", label: "Nadchodzące" },
  { value: "PAST", label: "Minione" },
  { value: "CANCELLED", label: "Anulowane" },
] as const;

export default async function TripsPage({ searchParams }: PageProps) {
  const resolved = await searchParams;
  const category = typeof resolved.category === "string" ? resolved.category : "";
  const cursor = typeof resolved.cursor === "string" ? resolved.cursor : undefined;

  const client = await createSessionApiClient();
  const page = await client.listTrips(
    { ...(category ? { category } : {}), ...(cursor ? { cursor } : {}), limit: 20 },
    { cache: "no-store" },
  );

  const link = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    const suffix = query.toString();
    return suffix ? `/account/trips?${suffix}` : "/account/trips";
  };

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Moje podróże</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Twoje rezerwacje
      </h1>

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Filtr podróży">
        {CATEGORIES.map((entry) => (
          <Link
            key={entry.value || "all"}
            href={entry.value ? link({ category: entry.value }) : link({})}
            className={`inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-bold transition-colors ${
              category === entry.value
                ? "border-accent bg-accent/12 text-ink"
                : "border-line bg-surface text-ink hover:border-ink/35"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {page.items.length === 0 ? (
        <div className="mt-8 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-12 text-center">
          <p className="text-[15px] text-muted">
            {category ? "Nic w tej kategorii." : "Nie masz jeszcze żadnych podróży."}
          </p>
          <Link href="/search" className={buttonStyles("accent", "md", "mt-4")}>
            <Compass size={17} strokeWidth={2.4} />
            Znajdź miejsce
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {page.items.map((trip) => (
              <TripCard key={trip.reference} trip={trip} />
            ))}
          </ul>

          {/* Keyset pagination: the cursor stays correct as new trips arrive. */}
          {page.nextCursor ? (
            <div className="mt-6">
              <Link
                href={link({
                  ...(category ? { category } : {}),
                  cursor: page.nextCursor,
                })}
                className={buttonStyles("outline", "md")}
              >
                Pokaż starsze
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
