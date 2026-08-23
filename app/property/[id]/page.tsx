import {
  ArrowLeft,
  Bath,
  BedDouble,
  DoorOpen,
  MapPin,
  Users,
  Waves,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { BookingCard } from "@/components/property/BookingCard";
import { Gallery } from "@/components/property/Gallery";
import { PropertyLocation } from "@/components/property/PropertyLocation";
import { Rating } from "@/components/property/Rating";
import { PROPERTIES, getPropertyById } from "@/data/properties";
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
import { parseSearchQuery } from "@/lib/search";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return PROPERTIES.map((property) => ({ id: property.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const property = getPropertyById(id);
  if (!property) return { title: "Nie znaleziono obiektu" };

  return {
    title: `${property.title}, ${property.district}`,
    description: property.description.slice(0, 160),
  };
}

export default async function PropertyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const property = getPropertyById(id);
  if (!property) notFound();

  // The stay carries over from the search page through the URL.
  const resolved = await searchParams;
  const query = parseSearchQuery(
    new URLSearchParams(
      Object.entries(resolved).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value] as [string, string]] : [],
      ),
    ),
  );

  // Going back keeps the same stay selected.
  const backToSearch = `/search?${new URLSearchParams({
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    adults: String(query.adults),
    children: String(query.children),
    destination: property.city,
  }).toString()}`;

  const keyFacts = [
    { icon: Users, label: formatGuestCapacity(property.maxGuests) },
    { icon: DoorOpen, label: formatBedrooms(property.bedrooms) },
    { icon: BedDouble, label: formatBeds(property.beds) },
    { icon: Bath, label: formatBathrooms(property.bathrooms) },
  ];

  return (
    <>
      <Header />

      <main className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">
        <div className="py-4">
          <Link
            href={backToSearch}
            className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
          >
            <ArrowLeft size={16} strokeWidth={2.4} />
            Wróć do wyników
          </Link>
        </div>

        <Gallery images={property.images} title={property.title} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
          <div>
            <p className="eyebrow">{PROPERTY_TYPE_LABELS[property.propertyType]}</p>
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
              {property.distanceToBeach !== undefined ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Waves size={14} strokeWidth={2.3} />
                    {formatBeachDistance(property.distanceToBeach)}
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
              <p className="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-muted">
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
                    {AMENITY_LABELS[amenity]}
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
              checkIn={query.checkIn}
              checkOut={query.checkOut}
              adults={query.adults}
              childrenCount={query.children}
            />
          </aside>
        </div>
      </main>
    </>
  );
}
