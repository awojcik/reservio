"use client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { SavingBadge } from "./SavingBadge";
import {
  formatGuests,
  formatLongDateRange,
  formatNights,
  formatPrice,
} from "@/lib/format";
import { calculateTotalPrice } from "@/lib/pricing";
import type { Property } from "@/lib/types";

type BookingCardProps = {
  property: Property;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount: number;
};

export function BookingCard({
  property,
  checkIn,
  checkOut,
  adults,
  childrenCount,
}: BookingCardProps) {
  const { showToast } = useToast();
  const price = calculateTotalPrice(property, checkIn, checkOut);

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
              ({formatPrice(property.pricePerNight)} × {price.nights})
            </span>
          </dt>
          <dd className="font-semibold tabular-nums">
            {formatPrice(price.accommodationPrice)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Sprzątanie</dt>
          <dd className="font-semibold tabular-nums">{formatPrice(price.cleaningFee)}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="text-[13px] font-bold tracking-[0.1em] uppercase">Razem</dt>
          <dd className="text-[24px] leading-none font-bold tracking-tight tabular-nums">
            {formatPrice(price.totalPrice)}
          </dd>
        </div>
      </dl>

      {price.saving > 0 ? (
        <div className="mt-4">
          <SavingBadge saving={price.saving} size="md" />
          <p className="mt-2 text-[13px] text-muted">
            Ten sam obiekt na dużych portalach kosztuje około{" "}
            {formatPrice(price.marketTotalPrice)}.
          </p>
        </div>
      ) : null}

      <Button
        size="lg"
        className="mt-5 w-full"
        onClick={() =>
          showToast("Rezerwacje online pojawią się w kolejnym etapie MVP.")
        }
      >
        Zarezerwuj
      </Button>

      <p className="mt-3 text-center text-[13px] text-muted">
        Nie pobieramy jeszcze płatności — to demonstracyjna wersja produktu.
      </p>
    </div>
  );
}
