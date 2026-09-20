import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { BookingForm } from "@/components/booking/BookingForm";
import { Header } from "@/components/layout/Header";
import { createServerApiClient } from "@/lib/api-server";
import { buildSearchParams, parseSearchQuery } from "@/lib/search";
import { loadIdentity } from "@/lib/session";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Rezerwacja" };

export default async function BookingPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolved = await searchParams;

  // The Stay travels in the URL, exactly as it does from search to detail.
  const query = parseSearchQuery(
    new URLSearchParams(
      Object.entries(resolved).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value] as [string, string]] : [],
      ),
    ),
  );

  /*
   * Booking needs a real Stay: the form creates a Hold over specific nights,
   * and without dates every amount and label on it is an Invalid Date. Rather
   * than render that, send the Guest to the one screen that can now fix it —
   * the Listing, where the dates are chosen (§7).
   */
  if (!query.checkIn || !query.checkOut) {
    redirect(`/property/${slug}?${buildSearchParams(query).toString()}`);
  }

  const identity = await loadIdentity();

  let property;
  try {
    property = await createServerApiClient().getProperty(
      slug,
      { checkIn: query.checkIn, checkOut: query.checkOut },
      // The price shown here must be current, so this page is never cached.
      { cache: "no-store" },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // The whole search travels back with the Guest, not just the stay: the
  // Listing hands it on to the results page, so a Guest who steps back twice
  // lands on the results they left.
  const backToProperty = `/property/${slug}?${buildSearchParams(query).toString()}`;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[640px] px-4 pb-20 sm:px-6">
        <div className="py-4">
          <Link
            href={backToProperty}
            className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
          >
            <ArrowLeft size={16} strokeWidth={2.4} />
            Wróć do obiektu
          </Link>
        </div>

        <h1 className="mb-6 text-[30px] leading-tight font-bold tracking-tightest">
          {property.bookingMode === "INSTANT_BOOK"
            ? "Dokończ rezerwację"
            : "Wyślij prośbę o rezerwację"}
        </h1>

        {property.available === false ? (
          <p
            role="alert"
            className="mb-5 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-4 py-3 text-[15px] font-semibold"
          >
            Ten termin jest już zajęty. Wybierz inne daty na stronie obiektu.
          </p>
        ) : null}

        <BookingForm
          property={property}
          bookingMode={property.bookingMode}
          // Prefilled from the profile, but still editable: these details
          // belong to this Booking, not to the account (milestone 06 §16).
          prefill={
            identity
              ? {
                  name: [identity.user.firstName, identity.user.lastName]
                    .filter(Boolean)
                    .join(" "),
                  email: identity.user.email,
                  phone: identity.user.phone ?? "",
                }
              : undefined
          }
          checkIn={query.checkIn}
          checkOut={query.checkOut}
          adults={query.adults}
          childrenCount={query.children}
        />
      </main>
    </>
  );
}
