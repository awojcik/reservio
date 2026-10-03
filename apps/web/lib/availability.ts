import type { PublicAvailability } from "@rezervio/api-client";

import { addDays } from "./calendar";

/**
 * Stay selection against the Property's taken dates.
 *
 * Everything here is a plain `YYYY-MM-DD` string and the half-open convention
 * `[checkIn, checkOut)` holds throughout — the same one the API stores in
 * `daterange(…, '[)')`. A block ending on the 16th does not collide with a
 * stay starting on the 16th, and that rule lives in exactly one place:
 * `isNightTaken` (docs/rezervio-domain-language.md §5B).
 *
 * > This calendar is a courtesy, never an authority. It stops a Guest from
 * > asking for nights that were already gone when the page loaded; it cannot
 * > know about the Hold somebody else took a second ago. The booking request
 * > is re-validated server-side, under the Property advisory lock, and that
 * > answer is the only one that decides anything
 * > (docs/architecture.md → "Rewalidacja").
 */

export type UnavailableRange = PublicAvailability["unavailableRanges"][number];

/** How far ahead the booking box asks for taken dates, in months. */
export const CALENDAR_HORIZON_MONTHS = 12;

/**
 * Today as the Property sees it.
 *
 * A Guest in Auckland must not be offered a night that is already yesterday in
 * Gdańsk, and must not be refused one that is still today there. The Property
 * time zone is the only clock that means anything here
 * (docs/rezervio-domain-language.md §7).
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    // `en-CA` renders as YYYY-MM-DD, which is the format the whole app uses.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown zone is bad Property data, not a reason to render nothing.
    return now.toISOString().slice(0, 10);
  }
}

/** The window of taken dates worth asking the API for. */
export function calendarWindow(
  today: string,
  months: number = CALENDAR_HORIZON_MONTHS,
): { from: string; to: string } {
  const [year, month, day] = today.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + months, day));
  return { from: today, to: end.toISOString().slice(0, 10) };
}

/**
 * Is the night starting on `date` already taken?
 *
 * `endDate` is exclusive, so the last taken night is the day before it. This
 * is the single off-by-one that decides whether check-in on a checkout day
 * works, and it is asserted directly in the tests.
 */
export function isNightTaken(date: string, ranges: readonly UnavailableRange[]): boolean {
  return ranges.some((range) => range.startDate <= date && date < range.endDate);
}

/** The first taken night on or after `date`, or `null` when the way is clear. */
export function firstTakenNightFrom(
  date: string,
  ranges: readonly UnavailableRange[],
  horizon: string,
): string | null {
  let earliest: string | null = null;

  for (const range of ranges) {
    // A range already under way counts from the day asked about.
    const start = range.startDate <= date ? (date < range.endDate ? date : null) : range.startDate;
    if (start === null || start >= horizon) continue;
    if (earliest === null || start < earliest) earliest = start;
  }

  return earliest;
}

/**
 * The latest check-out still reachable from `checkIn` without booking over a
 * taken night. Exclusive, so it is also the first day that cannot be selected.
 */
export function latestCheckOut(
  checkIn: string,
  ranges: readonly UnavailableRange[],
  horizon: string,
): string {
  const blocked = firstTakenNightFrom(checkIn, ranges, horizon);
  // Check-out *on* the first taken night is fine: that night is not part of
  // the stay.
  return blocked ?? horizon;
}

/** Can a stay start on this day? */
export function canCheckIn(
  date: string,
  ranges: readonly UnavailableRange[],
  today: string,
): boolean {
  return date >= today && !isNightTaken(date, ranges);
}

/**
 * Can a stay that starts on `checkIn` end on this day? At least one night, and
 * every night in between still free.
 */
export function canCheckOut(
  date: string,
  checkIn: string,
  ranges: readonly UnavailableRange[],
  horizon: string,
): boolean {
  return date > checkIn && date <= latestCheckOut(checkIn, ranges, horizon);
}

/** Nothing in `[checkIn, checkOut)` is taken — the whole stay fits. */
export function isStayAvailable(
  checkIn: string,
  checkOut: string,
  ranges: readonly UnavailableRange[],
): boolean {
  if (!(checkOut > checkIn)) return false;

  for (let date = checkIn; date < checkOut; date = addDays(date, 1)) {
    if (isNightTaken(date, ranges)) return false;
  }
  return true;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;

  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * Two-click range picking, availability-aware.
 *
 * A second click that would span a taken night does not produce an impossible
 * stay — it starts a new selection from that day instead. The alternative is
 * an error message for something the calendar already knew was impossible.
 */
export function nextStay(
  current: { checkIn: string; checkOut: string },
  date: string,
  ranges: readonly UnavailableRange[],
  horizon: string,
): { checkIn: string; checkOut: string } {
  const startingOver = !current.checkIn || Boolean(current.checkOut) || date <= current.checkIn;
  if (startingOver) return { checkIn: date, checkOut: "" };

  return canCheckOut(date, current.checkIn, ranges, horizon)
    ? { checkIn: current.checkIn, checkOut: date }
    : { checkIn: date, checkOut: "" };
}
