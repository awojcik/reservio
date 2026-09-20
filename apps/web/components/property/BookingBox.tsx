"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type PriceQuote, type PropertyDetail } from "@rezervio/api-client";

import { SavingBadge } from "@/components/property/SavingBadge";
import { StayPicker } from "@/components/property/StayPicker";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";
import { apiClient } from "@/lib/api";
import {
  calendarWindow,
  isStayAvailable,
  nightsBetween,
  todayInTimeZone,
  type UnavailableRange,
} from "@/lib/availability";
import { BOOKING_MODE_CTA } from "@/lib/booking";
import {
  formatAmountMinor,
  formatGuests,
  formatLongDateRange,
  formatNights,
} from "@/lib/format";
import { buildSearchParams, parseSearchQuery } from "@/lib/search";

type Quote =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; price: PriceQuote }
  | { status: "unavailable" }
  | { status: "error" };

type BookingBoxProps = {
  property: PropertyDetail;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount: number;
};

/**
 * Choosing a stay without leaving the Listing.
 *
 * A Guest who arrives here without dates used to be sent back to Search to
 * pick them and then back again — three navigations to answer a question this
 * page was already asking. The dates, the guests and the answer now live
 * together.
 *
 * Two rules the box does not get to bend:
 *
 *   - **The server prices the stay.** Every amount rendered here comes from
 *     the API's PriceQuote for these exact dates. Nothing is multiplied in the
 *     browser (docs/architecture.md → "Cenę ustala serwer").
 *   - **The server decides availability.** The calendar greys out what was
 *     taken when it loaded; the booking request re-checks under the Property
 *     lock, and only that answer creates a Hold.
 */
export function BookingBox({
  property,
  checkIn: initialCheckIn,
  checkOut: initialCheckOut,
  adults: initialAdults,
  childrenCount: initialChildren,
}: BookingBoxProps) {
  const searchParams = useSearchParams();

  const [stay, setStay] = useState({
    checkIn: initialCheckIn,
    checkOut: initialCheckOut,
  });
  const [guests, setGuests] = useState({
    adults: initialAdults,
    children: initialChildren,
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  /** Today and the horizon are the Property's, not the visitor's (§7). */
  const today = useMemo(() => todayInTimeZone(property.timeZone), [property.timeZone]);
  const calendarRange = useMemo(() => calendarWindow(today), [today]);

  const [ranges, setRanges] = useState<UnavailableRange[]>([]);
  const [rangesState, setRangesState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  /*
   * The page was rendered for these dates, so the API already answered for
   * them. Seeding from that answer means arriving from Search with a stay
   * shows the total immediately, with no second round trip.
   */
  const [quote, setQuote] = useState<Quote>(() => {
    if (!initialCheckIn || !initialCheckOut) return { status: "idle" };
    if (property.available === false) return { status: "unavailable" };
    return { status: "available", price: property.price };
  });

  const slug = property.slug;

  useEffect(() => {
    const controller = new AbortController();

    apiClient
      .getPublicAvailability(slug, calendarRange, { signal: controller.signal })
      .then((availability) => {
        setRanges(availability.unavailableRanges);
        setRangesState("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // An unknown calendar is not a broken page: the stay is verified
        // server-side either way.
        setRangesState("failed");
      });

    return () => controller.abort();
  }, [slug, calendarRange]);

  /**
   * The stay lives in the URL, so a reload, a shared link and the way back to
   * Search all agree with what is on screen. `replaceState` keeps the Server
   * Component from re-rendering under a box that already has the answer —
   * Next.js still syncs `useSearchParams` from it.
   */
  const syncUrl = useCallback(
    (next: { checkIn: string; checkOut: string; adults: number; children: number }) => {
      const query = parseSearchQuery(searchParams);
      const params = buildSearchParams({ ...query, ...next });
      const suffix = params.toString();
      window.history.replaceState(
        null,
        "",
        suffix ? `?${suffix}` : window.location.pathname,
      );
    },
    [searchParams],
  );

  /** Guard against an out-of-order response overwriting a newer one. */
  const requestId = useRef(0);

  const check = useCallback(
    (next: { checkIn: string; checkOut: string }) => {
      if (!next.checkIn || !next.checkOut) {
        requestId.current += 1;
        setQuote({ status: "idle" });
        return;
      }

      const id = ++requestId.current;
      setQuote({ status: "checking" });

      apiClient
        .getProperty(slug, { checkIn: next.checkIn, checkOut: next.checkOut })
        .then((fresh) => {
          if (id !== requestId.current) return;
          setQuote(
            fresh.available === false
              ? { status: "unavailable" }
              : { status: "available", price: fresh.price },
          );
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setQuote({ status: "error" });
        });
    },
    [slug],
  );

  function changeStay(next: { checkIn: string; checkOut: string }) {
    setStay(next);
    syncUrl({ ...next, ...guests });
    check(next);
  }

  function changeGuests(next: { adults: number; children: number }) {
    setGuests(next);
    syncUrl({ ...stay, ...next });
  }

  const retry = () => check(stay);

  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const totalGuests = guests.adults + guests.children;
  const overCapacity = totalGuests > property.maxGuests;

  /*
   * The page itself is cached for a minute, so the `available` it was
   * rendered with can be a minute old — long enough for the nights to have
   * gone. The freshly fetched calendar is allowed to overrule it, but only in
   * one direction: it may take a stay away, never hand one back. A "no" from
   * the server outranks anything the browser knows.
   */
  const takenByCalendar =
    rangesState === "ready" &&
    Boolean(stay.checkIn && stay.checkOut) &&
    !isStayAvailable(stay.checkIn, stay.checkOut, ranges);

  const showPrice = quote.status === "available" && !takenByCalendar;
  const showUnavailable =
    quote.status === "unavailable" || (quote.status === "available" && takenByCalendar);

  /*
   * The booking form gets the whole search too, so its own "back to the
   * Property" link can hand the Listing everything it arrived with — the
   * chain Search → Property → Booking survives in both directions.
   */
  const bookingHref = `/booking/${slug}?${buildSearchParams({
    ...parseSearchQuery(searchParams),
    ...stay,
    ...guests,
  }).toString()}`;

  return (
    <div className="rounded-[14px] border border-line bg-surface p-5">
      <p className="text-[15px]">
        <span className="text-[24px] leading-none font-bold tracking-tight tabular-nums">
          {formatAmountMinor(property.baseDailyRateAmountMinor)}
        </span>{" "}
        <span className="text-muted">/ noc</span>
      </p>

      <div className="mt-4 space-y-3">
        <StayPicker
          checkIn={stay.checkIn}
          checkOut={stay.checkOut}
          onChange={changeStay}
          ranges={ranges}
          today={today}
          horizon={calendarRange.to}
          loading={rangesState === "loading"}
          unknownAvailability={rangesState === "failed"}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />

        <div className="rounded-[10px] border border-line bg-surface px-3.5 py-1">
          <Stepper
            label="Goście"
            hint={`maks. ${property.maxGuests}`}
            value={guests.adults}
            min={1}
            max={property.maxGuests}
            onChange={(adults) => changeGuests({ ...guests, adults })}
          />
          <div className="border-t border-line" />
          <Stepper
            label="Dzieci"
            hint="do 12 lat"
            value={guests.children}
            min={0}
            max={Math.max(0, property.maxGuests - guests.adults)}
            onChange={(children) => changeGuests({ ...guests, children })}
          />
        </div>
      </div>

      {showPrice && quote.status === "available" ? (
        <>
          <p className="mt-5 text-[15px] font-bold">
            {formatLongDateRange(stay.checkIn, stay.checkOut)}
          </p>
          <p className="text-[14px] text-muted">
            {formatNights(nights)} · {formatGuests(guests.adults, guests.children)}
          </p>

          <dl className="mt-4 space-y-2 text-[15px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">
                Noclegi
                <span className="ml-1 text-[13px]">
                  ({formatAmountMinor(property.baseDailyRateAmountMinor)} ×{" "}
                  {quote.price.nights})
                </span>
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatAmountMinor(quote.price.accommodationAmountMinor)}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">Sprzątanie</dt>
              <dd className="font-semibold tabular-nums">
                {formatAmountMinor(quote.price.cleaningFeeAmountMinor)}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
              <dt className="text-[13px] font-bold tracking-[0.1em] uppercase">Razem</dt>
              <dd className="text-[24px] leading-none font-bold tracking-tight tabular-nums">
                {formatAmountMinor(quote.price.totalAmountMinor)}
              </dd>
            </div>
          </dl>

          {quote.price.savingAmountMinor ? (
            <div className="mt-4">
              <SavingBadge saving={quote.price.savingAmountMinor} size="md" />
              <p className="mt-2 text-[13px] text-muted">
                Ten sam obiekt na dużych portalach kosztuje około{" "}
                {formatAmountMinor(quote.price.marketAmountMinor ?? 0)}.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-5">
        {quote.status === "idle" ? (
          <Button
            variant="accent"
            size="lg"
            className="w-full"
            onClick={() => setPickerOpen(true)}
          >
            Wybierz daty
          </Button>
        ) : quote.status === "checking" ? (
          <p
            aria-live="polite"
            className="rounded-[10px] border border-line bg-background px-3.5 py-3 text-center text-[14px] font-bold"
          >
            Sprawdzamy dostępność…
          </p>
        ) : showUnavailable ? (
          <>
            <p
              role="status"
              className="rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-3 text-center text-[14px] font-bold"
            >
              Termin niedostępny
            </p>
            <Button
              variant="outline"
              size="lg"
              className="mt-2 w-full"
              onClick={() => setPickerOpen(true)}
            >
              Wybierz inne daty
            </Button>
          </>
        ) : quote.status === "error" ? (
          <>
            <p
              role="alert"
              className="rounded-[10px] border border-line bg-background px-3.5 py-3 text-center text-[14px]"
            >
              Nie udało się sprawdzić dostępności.
            </p>
            <Button variant="outline" size="lg" className="mt-2 w-full" onClick={retry}>
              Spróbuj ponownie
            </Button>
          </>
        ) : overCapacity ? (
          /*
           * The API refuses more Guests than the Property holds. Saying so
           * here is the difference between a corrected number and a rejected
           * form (domain §29.3).
           */
          <p
            role="status"
            className="rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-3 text-center text-[14px] font-bold"
          >
            Ten obiekt przyjmuje maksymalnie {property.maxGuests} gości
          </p>
        ) : (
          <Link href={bookingHref} className={buttonStyles("accent", "lg", "w-full")}>
            {BOOKING_MODE_CTA[property.bookingMode] ?? "Zarezerwuj"}
          </Link>
        )}
      </div>

      <p className="mt-3 text-center text-[13px] text-muted">
        {property.bookingMode === "INSTANT_BOOK"
          ? "Rezerwujesz od razu. Dostępność potwierdzamy jeszcze raz przy rezerwacji."
          : "Gospodarz potwierdza rezerwację. Dostępność potwierdzamy jeszcze raz przy rezerwacji."}
      </p>
    </div>
  );
}
