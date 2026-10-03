import { describe, expect, it } from "vitest";

import {
  calendarWindow,
  canCheckIn,
  canCheckOut,
  firstTakenNightFrom,
  isNightTaken,
  isStayAvailable,
  latestCheckOut,
  nextStay,
  nightsBetween,
  todayInTimeZone,
  type UnavailableRange,
} from "../lib/availability";

/**
 * The booking box offers nights the Property cannot sell only if this file is
 * wrong. Everything here is the half-open rule `[checkIn, checkOut)` — the
 * single most common source of off-by-one bugs in a reservation system
 * (docs/rezervio-domain-language.md §5B).
 */

const TAKEN: UnavailableRange[] = [
  { startDate: "2026-09-12", endDate: "2026-09-16" },
  { startDate: "2026-09-25", endDate: "2026-09-27" },
];

const HORIZON = "2027-09-20";

describe("half-open ranges", () => {
  it("treats every night from startDate up to (not including) endDate as taken", () => {
    expect(isNightTaken("2026-09-12", TAKEN)).toBe(true);
    expect(isNightTaken("2026-09-15", TAKEN)).toBe(true);
  });

  it("leaves the checkout day free — it is somebody else's departure, not a night", () => {
    expect(isNightTaken("2026-09-16", TAKEN)).toBe(false);
    expect(canCheckIn("2026-09-16", TAKEN, "2026-09-01")).toBe(true);
  });

  it("leaves the day before an arrival free", () => {
    expect(isNightTaken("2026-09-11", TAKEN)).toBe(false);
  });
});

describe("check-in days", () => {
  it("refuses a taken night", () => {
    expect(canCheckIn("2026-09-13", TAKEN, "2026-09-01")).toBe(false);
  });

  it("refuses yesterday", () => {
    expect(canCheckIn("2026-08-31", TAKEN, "2026-09-01")).toBe(false);
    expect(canCheckIn("2026-09-01", TAKEN, "2026-09-01")).toBe(true);
  });
});

describe("check-out days", () => {
  it("allows checking out on the day the next stay begins", () => {
    // Nights 9–11 are free; the 12th belongs to somebody else but is never
    // slept in by this stay.
    expect(canCheckOut("2026-09-12", "2026-09-09", TAKEN, HORIZON)).toBe(true);
  });

  it("refuses a range that would cross a taken night", () => {
    expect(canCheckOut("2026-09-14", "2026-09-09", TAKEN, HORIZON)).toBe(false);
    expect(canCheckOut("2026-09-20", "2026-09-09", TAKEN, HORIZON)).toBe(false);
  });

  it("refuses a zero-night stay", () => {
    expect(canCheckOut("2026-09-09", "2026-09-09", TAKEN, HORIZON)).toBe(false);
  });

  it("stops at the first taken night, and at the horizon when there is none", () => {
    expect(latestCheckOut("2026-09-09", TAKEN, HORIZON)).toBe("2026-09-12");
    expect(latestCheckOut("2026-10-01", TAKEN, HORIZON)).toBe(HORIZON);
    expect(firstTakenNightFrom("2026-09-13", TAKEN, HORIZON)).toBe("2026-09-13");
  });
});

describe("whole stays", () => {
  it("accepts a range that fits exactly between two bookings", () => {
    expect(isStayAvailable("2026-09-16", "2026-09-25", TAKEN)).toBe(true);
  });

  it("rejects a range overlapping a single taken night", () => {
    expect(isStayAvailable("2026-09-15", "2026-09-17", TAKEN)).toBe(false);
  });

  it("rejects a range that does not move forward", () => {
    expect(isStayAvailable("2026-09-16", "2026-09-16", TAKEN)).toBe(false);
  });

  it("counts nights, not days", () => {
    expect(nightsBetween("2026-09-12", "2026-09-16")).toBe(4);
    expect(nightsBetween("2026-09-12", "")).toBe(0);
  });
});

describe("two-click picking", () => {
  const empty = { checkIn: "", checkOut: "" };

  it("starts a range on the first click", () => {
    expect(nextStay(empty, "2026-09-16", TAKEN, HORIZON)).toEqual({
      checkIn: "2026-09-16",
      checkOut: "",
    });
  });

  it("closes the range on the second", () => {
    expect(
      nextStay({ checkIn: "2026-09-16", checkOut: "" }, "2026-09-20", TAKEN, HORIZON),
    ).toEqual({ checkIn: "2026-09-16", checkOut: "2026-09-20" });
  });

  it("starts over rather than producing a stay that spans a taken night", () => {
    expect(
      nextStay({ checkIn: "2026-09-09", checkOut: "" }, "2026-09-20", TAKEN, HORIZON),
    ).toEqual({ checkIn: "2026-09-20", checkOut: "" });
  });

  it("starts over on a click before the anchor", () => {
    expect(
      nextStay({ checkIn: "2026-09-16", checkOut: "" }, "2026-09-10", TAKEN, HORIZON),
    ).toEqual({ checkIn: "2026-09-10", checkOut: "" });
  });

  it("starts a new range once one is complete", () => {
    expect(
      nextStay(
        { checkIn: "2026-09-16", checkOut: "2026-09-20" },
        "2026-09-22",
        TAKEN,
        HORIZON,
      ),
    ).toEqual({ checkIn: "2026-09-22", checkOut: "" });
  });
});

describe("the Property's clock", () => {
  /**
   * 23:30 UTC is already tomorrow in Warsaw and still yesterday in Los
   * Angeles. "Today" has to be the Property's, or the calendar greys out a
   * night the Host is happily selling (§7).
   */
  const lateEvening = new Date("2026-09-11T23:30:00Z");

  it("reads today in the Property time zone", () => {
    expect(todayInTimeZone("Europe/Warsaw", lateEvening)).toBe("2026-09-12");
    expect(todayInTimeZone("America/Los_Angeles", lateEvening)).toBe("2026-09-11");
  });

  it("falls back to UTC rather than rendering nothing for a broken zone", () => {
    expect(todayInTimeZone("Not/AZone", lateEvening)).toBe("2026-09-11");
  });

  it("asks for a window that starts today and runs a year ahead", () => {
    expect(calendarWindow("2026-09-12")).toEqual({
      from: "2026-09-12",
      to: "2027-09-12",
    });
  });
});
