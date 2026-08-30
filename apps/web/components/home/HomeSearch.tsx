"use client";

import { MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { DatesPopover } from "@/components/search/DatesPopover";
import { GuestsPopover } from "@/components/search/GuestsPopover";
import { DESTINATION_SUGGESTIONS } from "@/components/search/SearchBar";
import {
  DEFAULT_CHECK_IN,
  DEFAULT_CHECK_OUT,
  DEFAULT_DESTINATION,
  EMPTY_QUERY,
  buildSearchParams,
} from "@/lib/search";

export function HomeSearch() {
  const router = useRouter();
  const listId = useId();

  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const [dates, setDates] = useState({
    checkIn: DEFAULT_CHECK_IN,
    checkOut: DEFAULT_CHECK_OUT,
  });
  const [guests, setGuests] = useState({ adults: 2, children: 2 });

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const params = buildSearchParams({
          ...EMPTY_QUERY,
          destination: destination.trim(),
          ...dates,
          ...guests,
        });
        router.push(`/search?${params.toString()}`);
      }}
      className="grid grid-cols-1 gap-1.5 rounded-[16px] border border-line bg-surface p-1.5 sm:grid-cols-[1.2fr_auto_1fr_auto_1fr_auto]"
    >
      <label className="flex h-14 items-center gap-2.5 px-4">
        <MapPin size={17} strokeWidth={2.2} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
            Gdzie jedziesz?
          </span>
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            list={listId}
            aria-label="Gdzie jedziesz?"
            placeholder="Miasto lub dzielnica"
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

      <div className="border-t border-line sm:border-0">
        <DatesPopover
          checkIn={dates.checkIn}
          checkOut={dates.checkOut}
          onChange={(checkIn, checkOut) => setDates({ checkIn, checkOut })}
        />
      </div>

      <Divider />

      <div className="border-t border-line sm:border-0">
        <GuestsPopover
          adults={guests.adults}
          childrenCount={guests.children}
          onChange={setGuests}
        />
      </div>

      {/*
        Coral, not brand: on the deep pine hero a brand-coloured button would
        sink into the background. Ink on coral, never white.
      */}
      <button
        type="submit"
        className="flex h-14 items-center justify-center gap-2 rounded-[11px] border border-accent-edge bg-accent px-6 text-[15px] font-bold text-ink transition-colors hover:bg-accent-hover"
      >
        <Search size={18} strokeWidth={2.6} />
        Szukaj
      </button>
    </form>
  );
}

function Divider() {
  return <div aria-hidden="true" className="hidden w-px bg-line sm:block" />;
}
