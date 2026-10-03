import type { BookingStatus } from "../infrastructure/database/schema";

/**
 * How a Booking is grouped in My Trips.
 *
 * A presentation grouping derived from status and dates — deliberately not a
 * Booking status of its own, because a trip moves from UPCOMING to PAST just
 * by time passing, with nothing to write (milestone 06 §11).
 */
export const TRIP_CATEGORIES = ["PENDING", "UPCOMING", "PAST", "CANCELLED"] as const;
export type TripCategory = (typeof TRIP_CATEGORIES)[number];

export function categorise(
  status: BookingStatus,
  checkOut: string,
  today: string,
): TripCategory {
  if (status === "CANCELLED" || status === "EXPIRED") return "CANCELLED";
  if (status === "PENDING_HOST_APPROVAL" || status === "PENDING_PAYMENT") return "PENDING";

  // checkOut is exclusive, so a stay ending today is already over.
  return checkOut > today ? "UPCOMING" : "PAST";
}
