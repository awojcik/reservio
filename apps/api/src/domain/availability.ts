import { BadRequestException } from "@nestjs/common";

/**
 * Availability is modelled as half-open calendar-date ranges — `[startDate,
 * endDate)` — everywhere in the system (domain language §5B, milestone 03 §6).
 *
 * A block ending on the 16th does not collide with a Stay starting on the 16th:
 * that is the whole point of the convention, and it is the single most common
 * source of off-by-one bugs in booking systems. Every comparison here is
 * written against that rule and nothing else.
 *
 * ISO dates compare correctly as plain strings, so no Date objects are involved
 * and there is no timezone to get wrong.
 */
export type DateRange = {
  startDate: string;
  endDate: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function assertValidRange(range: DateRange): void {
  if (!DATE_PATTERN.test(range.startDate) || !DATE_PATTERN.test(range.endDate)) {
    throw new BadRequestException("Daty muszą mieć format YYYY-MM-DD");
  }
  if (Number.isNaN(Date.parse(`${range.startDate}T00:00:00Z`))) {
    throw new BadRequestException(`Niepoprawna data: ${range.startDate}`);
  }
  if (Number.isNaN(Date.parse(`${range.endDate}T00:00:00Z`))) {
    throw new BadRequestException(`Niepoprawna data: ${range.endDate}`);
  }
  if (range.endDate <= range.startDate) {
    throw new BadRequestException("endDate musi być późniejszy niż startDate");
  }
}

/** `[a) ∩ [b) ≠ ∅`. Touching ranges do not overlap. */
export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.startDate < b.endDate && b.startDate < a.endDate;
}

/** True when the two ranges meet exactly, with no gap and no overlap. */
export function isAdjacent(a: DateRange, b: DateRange): boolean {
  return a.endDate === b.startDate || b.endDate === a.startDate;
}

/** Overlapping or touching — the condition for merging manual blocks. */
export function isContiguous(a: DateRange, b: DateRange): boolean {
  return overlaps(a, b) || isAdjacent(a, b);
}

/**
 * Union of every range that overlaps or touches another. Sorting first means a
 * single pass suffices, and the result is always disjoint and ordered.
 */
export function mergeRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) =>
    a.startDate === b.startDate
      ? a.endDate.localeCompare(b.endDate)
      : a.startDate.localeCompare(b.startDate),
  );

  const merged: DateRange[] = [{ ...sorted[0] }];

  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (isContiguous(last, range)) {
      if (range.endDate > last.endDate) last.endDate = range.endDate;
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

/**
 * `range \ hole`. Returns what is left, which is why unblocking a slice out of
 * the middle of a block yields two ranges rather than mangling one
 * (milestone 03 §15).
 *
 *   [12,16) minus [13,14)  ->  [12,13) and [14,16)
 *   [12,16) minus [10,20)  ->  []
 *   [12,16) minus [16,18)  ->  [12,16)   (touching, so untouched)
 */
export function subtractRange(range: DateRange, hole: DateRange): DateRange[] {
  if (!overlaps(range, hole)) return [{ ...range }];

  const remainder: DateRange[] = [];

  if (range.startDate < hole.startDate) {
    remainder.push({ startDate: range.startDate, endDate: hole.startDate });
  }
  if (hole.endDate < range.endDate) {
    remainder.push({ startDate: hole.endDate, endDate: range.endDate });
  }

  return remainder;
}

/** Clamps a range to a window, or null when the two do not intersect. */
export function intersectRange(a: DateRange, b: DateRange): DateRange | null {
  if (!overlaps(a, b)) return null;
  return {
    startDate: a.startDate > b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate < b.endDate ? a.endDate : b.endDate,
  };
}

/** Calendar-date arithmetic used by the sync horizon; UTC keeps it stable. */
export function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

export function today(timeZone = "UTC"): string {
  // `en-CA` formats as YYYY-MM-DD, which is exactly the shape used everywhere.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
