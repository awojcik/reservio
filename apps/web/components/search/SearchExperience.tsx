"use client";

import { List, Map as MapIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HeaderShell, type HeaderIdentity } from "@/components/layout/HeaderShell";
import { PropertyCard } from "@/components/property/PropertyCard";
import { useFavorites } from "@/components/property/useFavorites";
import { AiSearchField } from "./AiSearchField";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { ResultsSkeleton } from "./ResultsSkeleton";
import { useSearchResults } from "./useSearchResults";
import { FilterBar } from "./FilterBar";
import { ResultsHeader } from "./ResultsHeader";
import { SearchBar } from "./SearchBar";
import { cn } from "@/lib/cn";
import { readLastSearch, writeLastSearch } from "@/lib/last-search";
import {
  EMPTY_QUERY,
  buildSearchParams,
  countActiveFilters,
  hasSearchCriteria,
  parseSearchQuery,
} from "@/lib/search";
import type { MapBounds, SearchQuery } from "@/lib/types";

/** MapLibre touches `window` on import — keep it out of the server bundle. */
const PropertyMap = dynamic(() => import("@/components/map/PropertyMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 animate-pulse bg-placeholder" aria-hidden="true" />
  ),
});

export function SearchExperience({ identity }: { identity: HeaderIdentity }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = useMemo(() => parseSearchQuery(searchParams), [searchParams]);
  const { items: results, total, status, error, retry } = useSearchResults(query);
  const activeFilters = countActiveFilters(query);

  /**
   * The URL is the search. Nothing else may change it.
   *
   * The one exception is arriving with a bare `/search`: there is nothing to
   * honour, so the previous search on this device is restored into the URL —
   * which then becomes the search like any other. A visitor who follows a link
   * with parameters keeps those parameters, whatever this browser remembers
   * (§4).
   */
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    if (searchParams.toString().length > 0) return;

    const last = readLastSearch();
    if (!last) return;

    router.replace(`/search?${buildSearchParams(last).toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Remembered only once it says something worth repeating.
  useEffect(() => {
    writeLastSearch(query);
  }, [query]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  // A selection only survives while its property is still in the result set.
  const selectedId =
    pickedId && results.some((property) => property.id === pickedId)
      ? pickedId
      : null;
  const { favorites, toggleFavorite } = useFavorites();

  /**
   * The single biggest saving in the current results. Purely presentational:
   * it earns the coral edge on the card and the lime marker on the map.
   */
  const bestValueId = useMemo(() => {
    let best: (typeof results)[number] | null = null;
    for (const property of results) {
      const saving = property.price.savingAmountMinor ?? 0;
      if (saving > 0 && (!best || saving > (best.price.savingAmountMinor ?? 0))) {
        best = property;
      }
    }
    return best?.id ?? null;
  }, [results]);

  // The stay travels with the guest into the detail page.
  const stayQuery = useMemo(
    () =>
      // Empty dates are omitted rather than sent as blanks: the detail page
      // reads them back through the same parser, and "checkIn=" would be a
      // parameter that means nothing.
      buildSearchParams({
        ...EMPTY_QUERY,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        adults: query.adults,
        children: query.children,
      }).toString(),
    [query.checkIn, query.checkOut, query.adults, query.children],
  );

  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollTargetRef = useRef<string | null>(null);
  const resultsColumnRef = useRef<HTMLDivElement>(null);

  const patch = useCallback(
    (next: Partial<SearchQuery>) => {
      const params = buildSearchParams({ ...query, ...next });
      router.replace(`/search?${params.toString()}`, { scroll: false });
    },
    [query, router],
  );

  const resetFilters = useCallback(() => {
    patch({
      propertyTypes: [],
      minBedrooms: 0,
      pool: false,
      parking: false,
      nearBeach: false,
      minRating: 0,
      maxPrice: null,
      amenities: [],
      bounds: null,
    });
  }, [patch]);

  /** Marker click: select the property and bring its card into view. */
  const selectFromMap = useCallback((id: string) => {
    scrollTargetRef.current = id;
    setPickedId(id);
    setMobileView("list");
  }, []);

  const handleSearchArea = useCallback(
    (bounds: MapBounds) => patch({ bounds }),
    [patch],
  );

  useEffect(() => {
    const id = scrollTargetRef.current;
    if (!id) return;
    scrollTargetRef.current = null;

    const card = cardRefs.current.get(id);
    if (!card) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [selectedId, mobileView]);

  // New results start from the top of the column.
  useEffect(() => {
    resultsColumnRef.current?.scrollTo({ top: 0 });
  }, [results]);

  const map = (
    <PropertyMap
      results={results}
      selectedId={selectedId}
      hoveredId={hoveredId}
      onSelect={selectFromMap}
      onHover={setHoveredId}
      onSearchArea={handleSearchArea}
      fitKey={query.bounds ? null : query.destination}
      bestValueId={bestValueId}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <HeaderShell identity={identity} className="lg:static" />

      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
          <SearchBar query={query} onPatch={patch} />

          <div className="mt-3">
            <AiSearchField onPatch={patch} />
          </div>

          <div className="mt-4">
            <FilterBar
              query={query}
              onPatch={patch}
              onReset={resetFilters}
              activeCount={activeFilters}
            />
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 lg:min-h-0">
        <div
          ref={resultsColumnRef}
          className={cn(
            "scroll-quiet w-full px-4 py-5 sm:px-6 lg:w-[58%] lg:overflow-y-auto",
            mobileView === "map" && "hidden lg:block",
          )}
        >
          <ResultsHeader
            count={total}
            loading={status === "loading" && results.length === 0}
            destination={query.destination}
            sort={query.sort}
            onSortChange={(sort) => patch({ sort })}
          />

          {query.bounds ? (
            <button
              type="button"
              onClick={() => patch({ bounds: null })}
              className="mt-3 inline-flex h-11 items-center gap-2 rounded-full border border-accent bg-accent/12 px-4 text-[13px] font-bold"
            >
              Wyniki z obszaru mapy · pokaż wszystkie
            </button>
          ) : null}

          {status === "error" ? (
            <div className="mt-6">
              <ErrorState message={error ?? ""} onRetry={retry} />
            </div>
          ) : status === "loading" && results.length === 0 ? (
            <ResultsSkeleton />
          ) : results.length === 0 ? (
            <div className="mt-6">
              {/*
                Two different situations that used to look identical: a search
                that found nothing, and no search at all. The second is a
                first-time visitor, and telling them to "clear the filters"
                would be nonsense (§5).
              */}
              <EmptyState
                onReset={resetFilters}
                blank={!hasSearchCriteria(query) && activeFilters === 0}
              />
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-3 pb-24 lg:pb-6">
              {results.map((property) => (
                <li key={property.id}>
                  <div
                    ref={(element) => {
                      if (element) cardRefs.current.set(property.id, element);
                      else cardRefs.current.delete(property.id);
                    }}
                  >
                    <PropertyCard
                      property={property}
                      stayQuery={stayQuery}
                      selected={selectedId === property.id}
                      highlighted={hoveredId === property.id}
                      featured={bestValueId === property.id}
                      favorite={favorites.includes(property.id)}
                      onHover={setHoveredId}
                      onSelect={setPickedId}
                      onToggleFavorite={toggleFavorite}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside
          aria-label="Mapa ofert"
          className="relative hidden border-l border-line lg:block lg:w-[42%]"
        >
          {map}
        </aside>
      </main>

      {/* Mobile: list and map never share the screen. */}
      {mobileView === "map" ? (
        <div className="fixed inset-x-0 top-[72px] bottom-0 z-30 lg:hidden">{map}</div>
      ) : null}

      <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center lg:hidden">
        <button
          type="button"
          onClick={() => setMobileView(mobileView === "map" ? "list" : "map")}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-bold text-surface shadow-[0_8px_24px_-10px_rgba(16,24,20,0.65)]"
        >
          {mobileView === "map" ? (
            <>
              <List size={17} strokeWidth={2.5} />
              Lista
            </>
          ) : (
            <>
              <MapIcon size={17} strokeWidth={2.5} />
              Mapa
            </>
          )}
        </button>
      </div>
    </div>
  );
}
