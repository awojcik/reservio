"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { buildSearchParams, parseSearchQuery } from "@/lib/search";

/**
 * The way back to the results, carrying whatever the Guest has in hand.
 *
 * The Listing URL holds the whole search — destination, stay, guests, filters,
 * sort, map viewport — so going back reproduces the results page rather than a
 * fresh search. Dates changed on this page travel back too: the booking box
 * writes them into the URL, and this link reads the URL, so there is one state
 * and not two (docs/architecture.md → "Stan wyszukiwania").
 *
 * A Guest who arrived from a shared link has no search to return to, so the
 * Property's own city stands in — an empty results page would be a worse
 * answer than the obvious one.
 */
export function BackToSearchLink({ city }: { city: string }) {
  const searchParams = useSearchParams();
  const query = parseSearchQuery(searchParams);
  const params = buildSearchParams({
    ...query,
    destination: query.destination || city,
  });

  return (
    <Link
      href={`/search?${params.toString()}`}
      className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
    >
      <ArrowLeft size={16} strokeWidth={2.4} />
      Wróć do wyników
    </Link>
  );
}
