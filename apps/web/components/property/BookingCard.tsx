import Link from "next/link";

import type { PropertyDetail } from "@rezervio/api-client";

import { buttonStyles } from "@/components/ui/Button";
import { BOOKING_MODE_CTA } from "@/lib/booking";
import { SavingBadge } from "./SavingBadge";
import {
  formatAmountMinor,
  formatGuests,
  formatLongDateRange,
  formatNights,
} from "@/lib/format";

type BookingCardProps = {
  property: PropertyDetail;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount: number;
};

/** Every amount comes from the API's PriceQuote — nothing is recomputed here. */
export function BookingCard({
  property,
  checkIn,
  checkOut,
  adults,
  childrenCount,
}: BookingCardProps) {
  const price = property.price;

  // The Stay travels to the form in the URL, exactly as it arrived here.
  const bookingHref = `/booking/${property.slug}?${new URLSearchParams({
    checkIn,
    checkOut,
    adults: String(adults),
    children: String(childrenCount),
  }).toString()}`;

  const unavailable = property.available === false;

  return (
    <div className="rounded-[14px] border border-line bg-surface p-5">
      <p className="text-[16px] font-bold">{formatLongDateRange(checkIn, checkOut)}</p>
      <p className="text-[14px] text-muted">
        {formatGuests(adults, childrenCount)} · {formatNights(price.nights)}
      </p>

      <dl className="mt-5 space-y-2 text-[15px]">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">
            Noclegi
            <span className="ml-1 text-[13px]">
              ({formatAmountMinor(property.baseDailyRateAmountMinor)} × {price.nights})
            </span>
          </dt>
          <dd className="font-semibold tabular-nums">
            {formatAmountMinor(price.accommodationAmountMinor)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Sprzątanie</dt>
          <dd className="font-semibold tabular-nums">
            {formatAmountMinor(price.cleaningFeeAmountMinor)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="text-[13px] font-bold tracking-[0.1em] uppercase">Razem</dt>
          <dd className="text-[24px] leading-none font-bold tracking-tight tabular-nums">
            {formatAmountMinor(price.totalAmountMinor)}
          </dd>
        </div>
      </dl>

      {price.savingAmountMinor ? (
        <div className="mt-4">
          <SavingBadge saving={price.savingAmountMinor} size="md" />
          <p className="mt-2 text-[13px] text-muted">
            Ten sam obiekt na dużych portalach kosztuje około{" "}
            {formatAmountMinor(price.marketAmountMinor ?? 0)}.
          </p>
        </div>
      ) : null}

      {unavailable ? (
        <p className="mt-5 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-3 text-center text-[14px] font-bold">
          Ten termin jest zajęty
        </p>
      ) : (
        <Link href={bookingHref} className={buttonStyles("accent", "lg", "mt-5 w-full")}>
          {BOOKING_MODE_CTA[property.bookingMode] ?? "Zarezerwuj"}
        </Link>
      )}

      <p className="mt-3 text-center text-[13px] text-muted">
        {property.bookingMode === "INSTANT_BOOK"
          ? "Rezerwujesz od razu. Płatności jeszcze nie pobieramy."
          : "Gospodarz potwierdza rezerwację. Płatności jeszcze nie pobieramy."}
      </p>
    </div>
  );
}
