"use client";

import { MapPin, Search } from "lucide-react";
import { useId, useState } from "react";

import { DatesPopover } from "./DatesPopover";
import { GuestsPopover } from "./GuestsPopover";
import { cn } from "@/lib/cn";
import type { SearchQuery } from "@/lib/types";

export const DESTINATION_SUGGESTIONS = [
  "Gdańsk",
  "Sopot",
  "Brzeźno",
  "Jelitkowo",
  "Oliwa",
  "Wrzeszcz",
  "Śródmieście",
];

type SearchBarProps = {
  query: SearchQuery;
  onPatch: (patch: Partial<SearchQuery>) => void;
  className?: string;
};

/**
 * Command-bar rather than form: one surface, hairline dividers, a single
 * brand-coloured action. Dates and guests apply immediately; the destination
 * applies on submit so typing does not re-run the search on every keystroke.
 */
export function SearchBar({ query, onPatch, className }: SearchBarProps) {
  const listId = useId();
  const [destination, setDestination] = useState(query.destination);
  const [lastApplied, setLastApplied] = useState(query.destination);

  // The URL is the source of truth: when it changes (back button, AI search,
  // a link), the field follows it — the sanctioned "adjust state on prop
  // change during render" pattern, no effect needed.
  if (query.destination !== lastApplied) {
    setLastApplied(query.destination);
    setDestination(query.destination);
  }

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onPatch({ destination: destination.trim(), bounds: null });
      }}
      className={cn(
        "rounded-[16px] border border-line bg-surface p-1.5",
        "grid grid-cols-1 gap-1.5 lg:grid-cols-[1.15fr_auto_1fr_auto_1fr_auto]",
        className,
      )}
    >
      <label className="flex h-14 items-center gap-2.5 px-4">
        <MapPin size={17} strokeWidth={2.2} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
            Kierunek
          </span>
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            list={listId}
            placeholder="Dokąd jedziesz?"
            aria-label="Kierunek podróży"
            className="w-full bg-transparent text-[15px] font-bold outline-none placeholder:font-semibold placeholder:text-muted"
          />
          <datalist id={listId}>
            {DESTINATION_SUGGESTIONS.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
        </span>
      </label>

      <Divider />

      <div className="border-t border-line lg:border-0">
        <DatesPopover
          checkIn={query.checkIn}
          checkOut={query.checkOut}
          onChange={(checkIn, checkOut) => onPatch({ checkIn, checkOut })}
        />
      </div>

      <Divider />

      <div className="border-t border-line lg:border-0">
        <GuestsPopover
          adults={query.adults}
          childrenCount={query.children}
          onChange={(guests) => onPatch(guests)}
        />
      </div>

      <button
        type="submit"
        className="flex h-14 items-center justify-center gap-2 rounded-[11px] bg-brand px-5 text-[15px] font-bold text-surface transition-colors hover:bg-brand-hover lg:w-14 lg:px-0"
      >
        <Search size={18} strokeWidth={2.6} />
        <span className="lg:sr-only">Szukaj</span>
      </button>
    </form>
  );
}

function Divider() {
  return <div aria-hidden="true" className="hidden w-px bg-line lg:block" />;
}
