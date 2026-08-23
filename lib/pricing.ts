import { differenceInCalendarDays, parseISO } from "date-fns";

import type { PriceBreakdown, Property } from "./types";

/**
 * Every price shown in Rezervio is derived here, so switching to server-side
 * pricing later means replacing this one function.
 */
export function calculateTotalPrice(
  property: Property,
  checkIn: string | Date,
  checkOut: string | Date,
): PriceBreakdown {
  const from = typeof checkIn === "string" ? parseISO(checkIn) : checkIn;
  const to = typeof checkOut === "string" ? parseISO(checkOut) : checkOut;

  const rawNights = differenceInCalendarDays(to, from);
  const nights = Number.isFinite(rawNights) && rawNights > 0 ? rawNights : 1;

  const accommodationPrice = property.pricePerNight * nights;
  const cleaningFee = property.cleaningFee;
  const totalPrice = accommodationPrice + cleaningFee;

  const marketTotalPrice = property.marketPrice * nights + cleaningFee;
  const saving = Math.max(0, marketTotalPrice - totalPrice);

  return {
    nights,
    accommodationPrice,
    cleaningFee,
    totalPrice,
    saving,
    marketTotalPrice,
  };
}
