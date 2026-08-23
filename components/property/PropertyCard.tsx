"use client";

import { Heart } from "lucide-react";
import Link from "next/link";

import { ImageWithFallback } from "@/components/ui/ImageWithFallback";
import { Rating } from "./Rating";
import { SavingBadge } from "./SavingBadge";
import { cn } from "@/lib/cn";
import {
  AMENITY_LABELS,
  formatBeachDistance,
  formatBedrooms,
  formatGuestCapacity,
  formatNights,
  formatPrice,
} from "@/lib/format";
import type { SearchResult } from "@/lib/search";

type PropertyCardProps = {
  result: SearchResult;
  /** Serialised stay (dates + guests) carried over to the detail page. */
  stayQuery?: string;
  selected?: boolean;
  /** True while the matching map marker is hovered. */
  highlighted?: boolean;
  favorite?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
};

/** The three amenities that best describe a place at a glance. */
const PRIORITY_AMENITIES = [
  "pool",
  "seaView",
  "sauna",
  "terrace",
  "parking",
  "balcony",
  "fireplace",
  "bbq",
  "petFriendly",
  "airConditioning",
  "washer",
  "workspace",
  "elevator",
  "kitchen",
  "wifi",
] as const;

export function PropertyCard({
  result,
  stayQuery,
  selected = false,
  highlighted = false,
  favorite = false,
  onHover,
  onSelect,
  onToggleFavorite,
}: PropertyCardProps) {
  const { property, price } = result;

  const highlights = PRIORITY_AMENITIES.filter((amenity) =>
    property.amenities.includes(amenity),
  )
    .slice(0, 3)
    .map((amenity) => AMENITY_LABELS[amenity]);

  const details = [...highlights];
  if (property.distanceToBeach !== undefined) {
    details.push(formatBeachDistance(property.distanceToBeach));
  }

  return (
    <article
      onMouseEnter={() => onHover?.(property.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(property.id)}
      onBlur={() => onHover?.(null)}
      onPointerDown={() => onSelect?.(property.id)}
      className={cn(
        "group relative rounded-[14px] border bg-surface p-3 transition-[border-color,transform] duration-150",
        "hover:-translate-y-px hover:border-brand focus-within:border-brand",
        "sm:grid sm:grid-cols-[minmax(0,232px)_minmax(0,1fr)] sm:gap-4",
        selected || highlighted ? "border-brand" : "border-line",
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -left-1.5 size-3 rounded-full border-2 border-surface bg-accent"
        />
      ) : null}

      <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-[#EDE7DA]">
        <ImageWithFallback
          src={property.images[0]}
          alt={`${property.title} — ${property.district}, ${property.city}`}
          fill
          sizes="(max-width: 640px) 100vw, 232px"
          loading="lazy"
          className="object-cover"
        />
      </div>

      <div className="flex min-w-0 flex-col pt-3 sm:pt-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[18px] leading-tight font-bold tracking-tight">
            <Link
              href={`/property/${property.id}${stayQuery ? `?${stayQuery}` : ""}`}
              className="rounded-sm after:absolute after:inset-0 after:content-['']"
            >
              {property.title}
            </Link>
          </h3>

          <button
            type="button"
            aria-label={
              favorite
                ? `Usuń ${property.title} z ulubionych`
                : `Dodaj ${property.title} do ulubionych`
            }
            aria-pressed={favorite}
            onClick={() => onToggleFavorite?.(property.id)}
            className="relative z-10 -mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-accent"
          >
            <Heart
              size={19}
              strokeWidth={2.2}
              className={favorite ? "fill-accent text-accent" : undefined}
            />
          </button>
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-muted">
          <Rating rating={property.rating} className="text-ink" />
          <span aria-hidden="true">·</span>
          <span className="font-semibold">
            {property.city}, {property.district}
          </span>
        </p>

        <p className="mt-2 text-[14px] font-semibold">
          {formatBedrooms(property.bedrooms)} · {formatGuestCapacity(property.maxGuests)}
        </p>

        <p className="mt-0.5 truncate text-[14px] text-muted">{details.join(" · ")}</p>

        <div className="mt-3 text-right sm:mt-auto sm:pt-3">
          <div className="text-[21px] leading-none font-bold tracking-tight tabular-nums">
            {formatPrice(price.totalPrice)}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-muted">
            {formatNights(price.nights)} · cena całkowita
          </div>
          {price.saving > 0 ? (
            <div className="mt-2">
              <SavingBadge saving={price.saving} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
