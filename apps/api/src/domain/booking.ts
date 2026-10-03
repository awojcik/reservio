import { randomBytes } from "node:crypto";

import { BadRequestException } from "@nestjs/common";

import type { BookingStatus } from "../infrastructure/database/schema";

/**
 * Booking rules that need no database.
 *
 * Status changes go through named commands, never a generic
 * `updateBookingStatus` — the set of legal moves is small and worth stating
 * explicitly (milestone 04 §39, §40).
 */
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING_HOST_APPROVAL: ["PENDING_PAYMENT", "CANCELLED", "EXPIRED"],
  // CONFIRMED is reachable only through Payment, which is Milestone 05.
  PENDING_PAYMENT: ["CONFIRMED", "EXPIRED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  CANCELLED: [],
  EXPIRED: [],
  COMPLETED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Human-quotable identifier a Guest can read over the phone. Deliberately not
 * a secret: it identifies a Booking, it does not authorise anything
 * (milestone 04 §38).
 */
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

export function generateBookingReference(): string {
  const bytes = randomBytes(8);
  const body = Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length])
    .join("")
    .slice(0, 8);
  return `RZV-${body}`;
}

export type GuestCount = { adults: number; children: number };

export function assertCapacity(guests: GuestCount, maxGuests: number): void {
  if (guests.adults < 1) {
    throw new BadRequestException("Rezerwacja wymaga co najmniej jednej osoby dorosłej.");
  }
  if (guests.children < 0) {
    throw new BadRequestException("Liczba dzieci nie może być ujemna.");
  }
  if (guests.adults + guests.children > maxGuests) {
    throw new BadRequestException(
      `Ten obiekt przyjmuje maksymalnie ${maxGuests} ${maxGuests === 1 ? "osobę" : "osób"}.`,
    );
  }
}

/**
 * The financial snapshot stored on a Booking.
 *
 * Service fee, tax and discount are zero in this milestone but are separate
 * fields rather than folded into the total, so introducing them later does not
 * require reinterpreting historical rows (domain language §6).
 */
export type BookingAmounts = {
  accommodationAmountMinor: number;
  cleaningFeeAmountMinor: number;
  serviceFeeAmountMinor: number;
  taxAmountMinor: number;
  discountAmountMinor: number;
  totalAmountMinor: number;
  currency: string;
};

export function toBookingAmounts(quote: {
  accommodationAmountMinor: number;
  cleaningFeeAmountMinor: number;
  currency: string;
}): BookingAmounts {
  const serviceFeeAmountMinor = 0;
  const taxAmountMinor = 0;
  const discountAmountMinor = 0;

  return {
    accommodationAmountMinor: quote.accommodationAmountMinor,
    cleaningFeeAmountMinor: quote.cleaningFeeAmountMinor,
    serviceFeeAmountMinor,
    taxAmountMinor,
    discountAmountMinor,
    totalAmountMinor:
      quote.accommodationAmountMinor +
      quote.cleaningFeeAmountMinor +
      serviceFeeAmountMinor +
      taxAmountMinor -
      discountAmountMinor,
    currency: quote.currency,
  };
}
