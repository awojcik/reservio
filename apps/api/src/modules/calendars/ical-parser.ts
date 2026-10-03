import { createHash } from "node:crypto";

import ICAL from "ical.js";

import type { DateRange } from "../../domain/availability";

/**
 * iCal parsing on top of ical.js (the parser Thunderbird uses) rather than
 * hand-rolled regexes — RFC 5545 has line folding, escaping, timezones and
 * recurrence, none of which survive a regex (milestone 03 §26).
 */
export type ParsedEvent = {
  uid: string;
  range: DateRange;
};

export type ParseResult = {
  events: ParsedEvent[];
  /** Events deliberately skipped, for the sync log. Never fatal. */
  skipped: { reason: string; uid?: string }[];
};

export class IcalParseError extends Error {
  readonly code = "PARSE_ERROR";
}

/**
 * Formats an ICAL.Time as a local calendar date in the Property's timezone.
 *
 * All-day values are already calendar dates and must be taken verbatim; a
 * timestamp has to be moved into the Property's zone first, otherwise a
 * 23:00 UTC start silently lands on the previous day (milestone 03 §28).
 */
function toLocalDate(time: ICAL.Time, timeZone: string): string {
  if (time.isDate) {
    return `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time.toJSDate());
}

/**
 * A feed that omits UID still has to produce the same identity on every sync,
 * or reconciliation would delete and re-insert the same block forever.
 */
function fingerprint(start: string, end: string, summary: string): string {
  return `fp-${createHash("sha256").update(`${start}|${end}|${summary}`).digest("hex").slice(0, 32)}`;
}

export function parseIcal(source: string, timeZone: string): ParseResult {
  let component: ICAL.Component;
  try {
    component = new ICAL.Component(ICAL.parse(source));
  } catch (error) {
    throw new IcalParseError(`Nie udało się sparsować feedu iCal: ${(error as Error).message}`);
  }

  const events: ParsedEvent[] = [];
  const skipped: ParseResult["skipped"] = [];
  const seen = new Set<string>();

  for (const vevent of component.getAllSubcomponents("vevent")) {
    const uidValue = vevent.getFirstPropertyValue("uid");
    const uid = typeof uidValue === "string" ? uidValue : null;

    // A cancelled event releases the dates rather than blocking them.
    const status = vevent.getFirstPropertyValue("status");
    if (typeof status === "string" && status.toUpperCase() === "CANCELLED") {
      skipped.push({ reason: "CANCELLED", uid: uid ?? undefined });
      continue;
    }

    let start: ICAL.Time | null;
    let end: ICAL.Time | null;
    try {
      start = vevent.getFirstPropertyValue("dtstart") as ICAL.Time | null;
      end = vevent.getFirstPropertyValue("dtend") as ICAL.Time | null;
    } catch {
      skipped.push({ reason: "INVALID_DATES", uid: uid ?? undefined });
      continue;
    }

    if (!start) {
      skipped.push({ reason: "MISSING_DTSTART", uid: uid ?? undefined });
      continue;
    }

    // No DTEND is legal in RFC 5545 (DURATION, or an implicit one-day event),
    // but guessing a range would create a block the feed never asked for.
    if (!end) {
      const duration = vevent.getFirstPropertyValue("duration");
      if (!duration) {
        skipped.push({ reason: "MISSING_DTEND", uid: uid ?? undefined });
        continue;
      }
      try {
        end = start.clone();
        end.addDuration(duration as ICAL.Duration);
      } catch {
        skipped.push({ reason: "INVALID_DURATION", uid: uid ?? undefined });
        continue;
      }
    }

    const startDate = toLocalDate(start, timeZone);
    const endDate = toLocalDate(end, timeZone);

    // DTEND is already exclusive for all-day events, so nothing is subtracted
    // (milestone 03 §27). A timed event that ends the same local day still
    // occupies that night, so it is widened to one day rather than dropped.
    const normalisedEnd =
      endDate > startDate ? endDate : addOneDay(startDate);

    if (normalisedEnd <= startDate) {
      skipped.push({ reason: "EMPTY_RANGE", uid: uid ?? undefined });
      continue;
    }

    const summaryValue = vevent.getFirstPropertyValue("summary");
    const summary = typeof summaryValue === "string" ? summaryValue : "";

    const identity = uid?.trim() || fingerprint(startDate, normalisedEnd, summary);

    // A feed repeating the same UID (recurrence overrides, duplicates) must not
    // break the unique identity index.
    if (seen.has(identity)) {
      skipped.push({ reason: "DUPLICATE_UID", uid: identity });
      continue;
    }
    seen.add(identity);

    events.push({ uid: identity, range: { startDate, endDate: normalisedEnd } });
  }

  return { events, skipped };
}

function addOneDay(date: string): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}
