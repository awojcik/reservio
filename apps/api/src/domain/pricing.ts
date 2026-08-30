import { BadRequestException } from "@nestjs/common";

/**
 * PriceQuote for a Property + Stay, in integer minor units.
 *
 * MVP rules (docs/rezervio-milestone-01-backend-foundation.md §22):
 *   nights              = checkOut - checkIn
 *   accommodationAmount = nights * baseDailyRate
 *   totalAmount         = accommodationAmount + cleaningFee
 *   marketAmount        = nights * marketDailyRate + cleaningFee
 *   saving              = max(0, marketAmount - totalAmount)
 *
 * With no credible MarketPrice there is no Saving — the domain language is
 * explicit that an unreliable reference price must not be shown, so both
 * `marketAmountMinor` and `savingAmountMinor` come back null.
 */
export type PriceQuoteInput = {
  baseDailyRateAmountMinor: number;
  cleaningFeeAmountMinor: number;
  marketDailyRateAmountMinor: number | null;
  currency: string;
};

export type PriceQuote = {
  nights: number;
  accommodationAmountMinor: number;
  cleaningFeeAmountMinor: number;
  totalAmountMinor: number;
  marketAmountMinor: number | null;
  savingAmountMinor: number | null;
  currency: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Stay dates are calendar dates (YYYY-MM-DD), never timestamps. */
export function countNights(checkIn: string, checkOut: string): number {
  if (!DATE_PATTERN.test(checkIn) || !DATE_PATTERN.test(checkOut)) {
    throw new BadRequestException("checkIn i checkOut muszą mieć format YYYY-MM-DD");
  }

  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new BadRequestException("checkIn lub checkOut nie jest poprawną datą");
  }

  const nights = Math.round((to - from) / MS_PER_DAY);
  if (nights < 1) {
    throw new BadRequestException("checkOut musi być późniejszy niż checkIn");
  }

  return nights;
}

export function calculatePriceQuote(
  property: PriceQuoteInput,
  checkIn: string,
  checkOut: string,
): PriceQuote {
  const nights = countNights(checkIn, checkOut);

  const accommodationAmountMinor = property.baseDailyRateAmountMinor * nights;
  const cleaningFeeAmountMinor = property.cleaningFeeAmountMinor;
  const totalAmountMinor = accommodationAmountMinor + cleaningFeeAmountMinor;

  const marketAmountMinor =
    property.marketDailyRateAmountMinor === null
      ? null
      : property.marketDailyRateAmountMinor * nights + cleaningFeeAmountMinor;

  const savingAmountMinor =
    marketAmountMinor === null ? null : Math.max(0, marketAmountMinor - totalAmountMinor);

  return {
    nights,
    accommodationAmountMinor,
    cleaningFeeAmountMinor,
    totalAmountMinor,
    marketAmountMinor,
    savingAmountMinor,
    currency: property.currency,
  };
}
