import {
  ArrowLeft,
  Bath,
  BedDouble,
  DoorOpen,
  MapPin,
  Users,
  Waves,
} from "lucide-react";
import Link from "next/link";

import type { PropertyDetail } from "@rezervio/api-client";

import { BookingCard } from "@/components/property/BookingCard";
import { Gallery } from "@/components/property/Gallery";
import { PropertyLocation } from "@/components/property/PropertyLocation";
import { Rating } from "@/components/property/Rating";
import {
  AMENITY_LABELS,
  PROPERTY_TYPE_LABELS,
  formatBathrooms,
  formatBeachDistance,
  formatBedrooms,
  formatBeds,
  formatGuestCapacity,
  formatReviews,
} from "@/lib/format";
import type { Amenity } from "@/lib/types";

type PropertyDetailViewProps = {
  property: PropertyDetail;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount: number;
  backHref: string;
  backLabel: string;
};

/**
 * The whole Listing presentation, shared verbatim by the public page and the
 * Host preview. Keeping one implementation is the point — a preview that
 * drifts from the real page is worse than no preview (milestone 02 §45).
 */
export function PropertyDetailView({
  property,
  checkIn,
  checkOut,
  adults,
  childrenCount,
  backHref,
  backLabel,
}: PropertyDetailViewProps) {
  const keyFacts = [
    { icon: Users, label: formatGuestCapacity(property.maxGuests) },
    { icon: DoorOpen, label: formatBedrooms(property.bedrooms) },
    { icon: BedDouble, label: formatBeds(property.beds) },
    { icon: Bath, label: formatBathrooms(property.bathrooms) },
  ];

  return (
    <>
      <div className="py-4">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
        >
          <ArrowLeft size={16} strokeWidth={2.4} />
          {backLabel}
        </Link>
      </div>

      <Gallery
        images={property.images.map((image) => image.url)}
        title={property.title}
      />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <div>
          <p className="eyebrow">
            {PROPERTY_TYPE_LABELS[
              property.propertyType as keyof typeof PROPERTY_TYPE_LABELS
            ] ?? property.propertyType}
          </p>
          <h1 className="mt-2 text-[32px] leading-tight font-bold tracking-tightest sm:text-[40px]">
            {property.title}
          </h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted">
            <Rating rating={property.rating} size={15} className="text-ink" />
            <span aria-hidden="true">·</span>
            <span className="font-semibold">{formatReviews(property.reviewCount)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <MapPin size={14} strokeWidth={2.3} />
              {property.city}, {property.district}
            </span>
            {property.distanceToBeachMeters !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Waves size={14} strokeWidth={2.3} />
                  {formatBeachDistance(property.distanceToBeachMeters)}
                </span>
              </>
            ) : null}
          </p>

          <ul className="mt-7 grid grid-cols-2 gap-3 border-y border-line py-5 sm:grid-cols-4">
            {keyFacts.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5">
                <Icon size={19} strokeWidth={2.1} className="shrink-0 text-brand" />
                <span className="text-[15px] font-bold">{label}</span>
              </li>
            ))}
          </ul>

          <section className="mt-8">
            <h2 className="text-[22px] font-bold tracking-tight">O tym miejscu</h2>
            <p className="mt-3 max-w-[62ch] text-[16px] leading-relaxed whitespace-pre-line text-muted">
              {property.description}
            </p>
          </section>

          <section className="mt-8">
            <h2 className="text-[22px] font-bold tracking-tight">Udogodnienia</h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              {property.amenities.slice(0, 10).map((amenity) => (
                <li
                  key={amenity}
                  className="flex items-center gap-2 text-[15px] font-semibold"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-accent"
                  />
                  {AMENITY_LABELS[amenity as Amenity] ?? amenity}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-[22px] font-bold tracking-tight">Lokalizacja</h2>
            <p className="mt-2 text-[15px] text-muted">
              {property.district}, {property.city} — dokładny adres przekazujemy po
              rezerwacji.
            </p>
            <div className="mt-4">
              <PropertyLocation
                latitude={property.latitude}
                longitude={property.longitude}
                label={`${property.title}, ${property.district}`}
              />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-[88px] lg:self-start">
          <BookingCard
            property={property}
            adults={adults}
            childrenCount={childrenCount}
            checkIn={checkIn}
            checkOut={checkOut}
          />
        </aside>
      </div>
    </>
  );
}
