import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiError, type PropertyDetail } from "@rezervio/api-client";

import { Header } from "@/components/layout/Header";
import { PropertyDetailView } from "@/components/property/PropertyDetailView";
import { createServerApiClient } from "@/lib/api-server";
import { parseSearchQuery } from "@/lib/search";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The route segment is still called `id` so public URLs keep their shape, but
 * the value is the Property slug — the domain's public routing identity. The
 * API accepts a UUID too, so older links keep resolving.
 */
async function loadProperty(
  slug: string,
  checkIn?: string,
  checkOut?: string,
): Promise<PropertyDetail> {
  try {
    return await createServerApiClient().getProperty(
      slug,
      { checkIn, checkOut },
      // Detail pages are cheap to re-fetch and must reflect edits quickly.
      { revalidate: 60 },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const property = await loadProperty(id);
    return {
      title: `${property.title}, ${property.district}`,
      description: (property.description ?? "").slice(0, 160),
    };
  } catch {
    return { title: "Nie znaleziono obiektu" };
  }
}

export default async function PropertyPage({ params, searchParams }: PageProps) {
  const { id } = await params;

  // The stay carries over from the search page through the URL.
  const resolved = await searchParams;
  const query = parseSearchQuery(
    new URLSearchParams(
      Object.entries(resolved).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value] as [string, string]] : [],
      ),
    ),
  );

  const property = await loadProperty(id, query.checkIn, query.checkOut);

  // Going back keeps the same stay selected.
  const backToSearch = `/search?${new URLSearchParams({
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    adults: String(query.adults),
    children: String(query.children),
    destination: property.city,
  }).toString()}`;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">
        <PropertyDetailView
          property={property}
          checkIn={query.checkIn}
          checkOut={query.checkOut}
          adults={query.adults}
          childrenCount={query.children}
          backHref={backToSearch}
          backLabel="Wróć do wyników"
        />
      </main>
    </>
  );
}
