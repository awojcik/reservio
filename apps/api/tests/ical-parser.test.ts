import { describe, expect, it } from "vitest";

import { IcalParseError, parseIcal } from "../src/modules/calendars/ical-parser";
import {
  ALL_DAY_FEED,
  CANCELLED_FEED,
  DURATION_FEED,
  GARBAGE_FEED,
  MISSING_DTEND_FEED,
  MULTI_EVENT_FEED,
  NO_UID_FEED,
  TIMED_UTC_FEED,
} from "./fixtures/ical";

const WARSAW = "Europe/Warsaw";

describe("iCal parser", () => {
  it("maps an all-day event without shifting DTEND", () => {
    const { events } = parseIcal(ALL_DAY_FEED, WARSAW);

    // DTEND is already exclusive for VALUE=DATE — subtracting a day here is the
    // single most common iCal bug.
    expect(events).toEqual([
      { uid: "booking-1@example.com", range: { startDate: "2026-09-12", endDate: "2026-09-16" } },
    ]);
  });

  it("reads every event in the feed", () => {
    const { events } = parseIcal(MULTI_EVENT_FEED, WARSAW);
    expect(events.map((event) => event.uid)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("drops CANCELLED events so the dates stay free", () => {
    const { events, skipped } = parseIcal(CANCELLED_FEED, WARSAW);

    expect(events.map((event) => event.uid)).toEqual(["live@example.com"]);
    expect(skipped).toContainEqual({ reason: "CANCELLED", uid: "gone@example.com" });
  });

  it("converts timestamps into the Property timezone before taking the date", () => {
    const { events } = parseIcal(TIMED_UTC_FEED, WARSAW);

    // 22:00 UTC on the 11th is already the 12th in Warsaw (UTC+2 in September).
    expect(events[0].range).toEqual({ startDate: "2026-09-12", endDate: "2026-09-15" });
  });

  it("gives a different answer in a different timezone", () => {
    const warsaw = parseIcal(TIMED_UTC_FEED, WARSAW).events[0].range;
    const utc = parseIcal(TIMED_UTC_FEED, "UTC").events[0].range;

    expect(warsaw.startDate).toBe("2026-09-12");
    expect(utc.startDate).toBe("2026-09-11");
  });

  it("skips an event with no end instead of inventing one", () => {
    const { events, skipped } = parseIcal(MISSING_DTEND_FEED, WARSAW);

    expect(events.map((event) => event.uid)).toEqual(["fine@example.com"]);
    expect(skipped).toContainEqual({ reason: "MISSING_DTEND", uid: "broken@example.com" });
  });

  it("honours DURATION when DTEND is absent", () => {
    const { events } = parseIcal(DURATION_FEED, WARSAW);
    expect(events[0].range).toEqual({ startDate: "2026-09-12", endDate: "2026-09-16" });
  });

  it("derives a stable identity when the feed omits UID", () => {
    const first = parseIcal(NO_UID_FEED, WARSAW).events[0];
    const second = parseIcal(NO_UID_FEED, WARSAW).events[0];

    // Re-syncing an unchanged feed must not churn the same block.
    expect(first.uid).toBe(second.uid);
    expect(first.uid).toMatch(/^fp-[0-9a-f]{32}$/);
  });

  it("raises a typed error on unparseable input rather than crashing", () => {
    expect(() => parseIcal(GARBAGE_FEED, WARSAW)).toThrow(IcalParseError);
  });
});
