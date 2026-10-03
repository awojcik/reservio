/**
 * Stay timing.
 *
 * Everything here works in the Property's own time zone. "Check-in from 15:00"
 * means three in the afternoon where the Property stands — not 15:00 UTC, and
 * not 15:00 wherever the server happens to run (milestone 09 §7).
 */
export const STAY_PHASES = ["BEFORE_STAY", "IN_STAY", "AFTER_STAY"] as const;
export type StayPhase = (typeof STAY_PHASES)[number];

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidLocalTime(value: string): boolean {
  return TIME.test(value);
}

/**
 * The offset a zone was at, at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than a table: the runtime already ships the
 * IANA database, and shipping a second copy would guarantee the two disagree
 * the next time a country changes its mind about daylight saving.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  // `hour` comes back as 24 at midnight in some ICU versions.
  const hour = read("hour") % 24;

  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );

  return asIfUtc - instant.getTime();
}

/**
 * A local date and wall-clock time in a zone, as a UTC instant.
 *
 * Two passes: the first guesses the offset using the naive instant, the second
 * corrects it when that guess landed on the other side of a DST change.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) {
    throw new RangeError(`Nieprawidłowa data lub godzina: ${date} ${time}`);
  }

  const firstGuess = naive - offsetAt(new Date(naive), timeZone);
  return new Date(naive - offsetAt(new Date(firstGuess), timeZone));
}

/** Formats an instant as a wall-clock time in the Property's zone. */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone,
    dateStyle: "long",
    timeStyle: "short",
  }).format(instant);
}

export type StayWindow = {
  /** When the Guest may arrive, as an instant. */
  checkInAt: Date;
  /** When the Guest must be gone, as an instant. */
  checkOutAt: Date;
};

export function stayWindow(input: {
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  timeZone: string;
}): StayWindow {
  return {
    checkInAt: zonedTimeToUtc(input.checkIn, input.checkInTime, input.timeZone),
    checkOutAt: zonedTimeToUtc(input.checkOut, input.checkOutTime, input.timeZone),
  };
}

/**
 * Where the Stay is right now.
 *
 * Computed, never stored: a Guest is not asked to announce their arrival, and
 * a status column would only be a second thing to get wrong
 * (milestone 09 §14, §58).
 */
export function stayPhase(window: StayWindow, now: Date = new Date()): StayPhase {
  if (now.getTime() < window.checkInAt.getTime()) return "BEFORE_STAY";
  if (now.getTime() < window.checkOutAt.getTime()) return "IN_STAY";
  return "AFTER_STAY";
}

/** Subtracts an offset in hours from an instant. */
export function hoursBefore(instant: Date, hours: number): Date {
  return new Date(instant.getTime() - hours * 3_600_000);
}
