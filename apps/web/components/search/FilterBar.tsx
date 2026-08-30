"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { Chip } from "@/components/ui/Chip";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";
import {
  AMENITY_LABELS,
  PROPERTY_TYPE_LABELS,
  formatBedrooms,
  formatAmountMinor,
  formatRating,
} from "@/lib/format";
import { PROPERTY_TYPES } from "@/lib/search";
import type { Amenity, PropertyType, SearchQuery } from "@/lib/types";

const PRICE_MIN = 500;
const PRICE_MAX = 12000;
const PRICE_STEP = 100;

const RATING_OPTIONS = [8, 8.5, 9, 9.5];

const EXTRA_AMENITIES: Amenity[] = [
  "SEA_VIEW",
  "TERRACE",
  "BALCONY",
  "SAUNA",
  "FIREPLACE",
  "BBQ",
  "AIR_CONDITIONING",
  "WASHING_MACHINE",
  "PET_FRIENDLY",
  "WORKSPACE",
  "ELEVATOR",
  "WIFI",
];

type FilterBarProps = {
  query: SearchQuery;
  onPatch: (patch: Partial<SearchQuery>) => void;
  onReset: () => void;
  activeCount: number;
};

export function FilterBar({ query, onPatch, onReset, activeCount }: FilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Filtry"
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <PricePopover query={query} onPatch={onPatch} />
      <TypePopover query={query} onPatch={onPatch} />
      <BedroomsPopover query={query} onPatch={onPatch} />

      <Chip
        active={query.pool}
        aria-pressed={query.pool}
        onClick={() => onPatch({ pool: !query.pool })}
      >
        Basen
      </Chip>
      <Chip
        active={query.parking}
        aria-pressed={query.parking}
        onClick={() => onPatch({ parking: !query.parking })}
      >
        Parking
      </Chip>
      <Chip
        active={query.nearBeach}
        aria-pressed={query.nearBeach}
        onClick={() => onPatch({ nearBeach: !query.nearBeach })}
      >
        {query.nearBeach ? "Plaża do 500 m" : "Plaża"}
      </Chip>

      <RatingPopover query={query} onPatch={onPatch} />
      <MoreFiltersDialog query={query} onPatch={onPatch} />

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          <X size={15} strokeWidth={2.6} />
          Wyczyść ({activeCount})
        </button>
      ) : null}
    </div>
  );
}

function PricePopover({ query, onPatch }: Pick<FilterBarProps, "query" | "onPatch">) {
  const [draft, setDraft] = useState(query.maxPrice ?? PRICE_MAX);
  const active = query.maxPrice !== null;

  return (
    <Popover onOpenChange={(open) => open && setDraft(query.maxPrice ?? PRICE_MAX)}>
      <PopoverTrigger asChild>
        <Chip active={active} withChevron>
          {active ? `Do ${formatAmountMinor(query.maxPrice!)}` : "Cena"}
        </Chip>
      </PopoverTrigger>

      <PopoverContent className="w-[300px]">
        <div className="mb-1 text-[13px] font-bold tracking-[0.1em] text-muted uppercase">
          Cena całkowita za pobyt
        </div>
        <div className="mb-3 text-[22px] font-bold tracking-tight">
          {draft >= PRICE_MAX ? "Bez limitu" : `do ${formatAmountMinor(draft)}`}
        </div>

        <input
          type="range"
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          value={draft}
          aria-label="Maksymalna cena całkowita"
          onChange={(event) => {
            const value = Number(event.target.value);
            setDraft(value);
            onPatch({ maxPrice: value >= PRICE_MAX ? null : value });
          }}
          className="h-11 w-full accent-brand"
        />

        <div className="flex justify-between text-[12px] font-semibold text-muted">
          <span>{formatAmountMinor(PRICE_MIN)}</span>
          <span>bez limitu</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TypePopover({ query, onPatch }: Pick<FilterBarProps, "query" | "onPatch">) {
  const active = query.propertyTypes.length > 0;

  function toggle(type: PropertyType, checked: boolean) {
    onPatch({
      propertyTypes: checked
        ? [...query.propertyTypes, type]
        : query.propertyTypes.filter((value) => value !== type),
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip active={active} withChevron>
          {query.propertyTypes.length === 1
            ? PROPERTY_TYPE_LABELS[query.propertyTypes[0]]
            : active
              ? `Typ obiektu (${query.propertyTypes.length})`
              : "Typ obiektu"}
        </Chip>
      </PopoverTrigger>

      <PopoverContent className="w-[240px]">
        {PROPERTY_TYPES.map((type) => (
          <Checkbox
            key={type}
            label={PROPERTY_TYPE_LABELS[type]}
            checked={query.propertyTypes.includes(type)}
            onChange={(checked) => toggle(type, checked)}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function BedroomsPopover({ query, onPatch }: Pick<FilterBarProps, "query" | "onPatch">) {
  const active = query.minBedrooms > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip active={active} withChevron>
          {active ? `Min. ${formatBedrooms(query.minBedrooms)}` : "Sypialnie"}
        </Chip>
      </PopoverTrigger>

      <PopoverContent className="w-[260px]">
        <div className="mb-2 text-[13px] font-bold tracking-[0.1em] text-muted uppercase">
          Minimum sypialni
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2, 3, 4].map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={query.minBedrooms === count}
              onClick={() => onPatch({ minBedrooms: count })}
              className={
                query.minBedrooms === count
                  ? "h-11 flex-1 rounded-[10px] border border-brand bg-brand text-[14px] font-bold text-surface"
                  : "h-11 flex-1 rounded-[10px] border border-line text-[14px] font-bold transition-colors hover:border-ink/35"
              }
            >
              {count === 0 ? "Bez" : count === 4 ? "4+" : count}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RatingPopover({ query, onPatch }: Pick<FilterBarProps, "query" | "onPatch">) {
  const active = query.minRating > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip active={active} withChevron>
          {active ? `Ocena od ${formatRating(query.minRating)}` : "Ocena"}
        </Chip>
      </PopoverTrigger>

      <PopoverContent className="w-[260px]">
        <div className="mb-2 text-[13px] font-bold tracking-[0.1em] text-muted uppercase">
          Ocena gości
        </div>
        <div className="flex gap-1.5">
          {[0, ...RATING_OPTIONS].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={query.minRating === value}
              onClick={() => onPatch({ minRating: value })}
              className={
                query.minRating === value
                  ? "h-11 flex-1 rounded-[10px] border border-brand bg-brand text-[14px] font-bold text-surface"
                  : "h-11 flex-1 rounded-[10px] border border-line text-[14px] font-bold transition-colors hover:border-ink/35"
              }
            >
              {value === 0 ? "Każda" : `${formatRating(value)}+`}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MoreFiltersDialog({ query, onPatch }: Pick<FilterBarProps, "query" | "onPatch">) {
  const count = query.amenities.length;

  function toggle(amenity: Amenity, checked: boolean) {
    onPatch({
      amenities: checked
        ? [...query.amenities, amenity]
        : query.amenities.filter((value) => value !== amenity),
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Chip active={count > 0}>
          <SlidersHorizontal size={15} strokeWidth={2.4} className="-ml-0.5" />
          {count > 0 ? `Więcej filtrów (${count})` : "Więcej filtrów"}
        </Chip>
      </DialogTrigger>

      <DialogContent title="Więcej filtrów">
        <div className="scroll-quiet grid grid-cols-2 gap-x-4 overflow-y-auto px-5 py-4">
          {EXTRA_AMENITIES.map((amenity) => (
            <Checkbox
              key={amenity}
              label={AMENITY_LABELS[amenity]}
              checked={query.amenities.includes(amenity)}
              onChange={(checked) => toggle(amenity, checked)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={() => onPatch({ amenities: [] })}
            className="text-[14px] font-bold text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            Wyczyść udogodnienia
          </button>
          <DialogClose asChild>
            <Button size="sm">Pokaż wyniki</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
