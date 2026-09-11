import { describe, expect, it } from "vitest";

import {
  hoursBefore,
  isValidLocalTime,
  stayPhase,
  stayWindow,
  zonedTimeToUtc,
} from "../src/domain/stay";

describe("zonedTimeToUtc", () => {
  it("interprets the wall clock in the Property's zone", () => {
    // Warsaw is UTC+2 in September.
    expect(zonedTimeToUtc("2026-09-12", "15:00", "Europe/Warsaw").toISOString()).toBe(
      "2026-09-12T13:00:00.000Z",
    );
    // Madrid happens to match Warsaw here; Reykjavik does not.
    expect(zonedTimeToUtc("2026-09-12", "15:00", "Atlantic/Reykjavik").toISOString()).toBe(
      "2026-09-12T15:00:00.000Z",
    );
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // Same wall clock, opposite sides of the European DST switch.
    expect(zonedTimeToUtc("2026-07-01", "15:00", "Europe/Warsaw").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-01-15", "15:00", "Europe/Warsaw").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("handles a zone on the other side of the date line", () => {
    expect(zonedTimeToUtc("2026-09-12", "11:00", "Pacific/Auckland").toISOString()).toBe(
      "2026-09-11T23:00:00.000Z",
    );
  });

  it("rejects nonsense", () => {
    expect(() => zonedTimeToUtc("nie-data", "15:00", "Europe/Warsaw")).toThrow();
  });
});

describe("isValidLocalTime", () => {
  it("accepts a 24-hour wall clock only", () => {
    expect(isValidLocalTime("15:00")).toBe(true);
    expect(isValidLocalTime("00:00")).toBe(true);
    expect(isValidLocalTime("23:59")).toBe(true);
    expect(isValidLocalTime("24:00")).toBe(false);
    expect(isValidLocalTime("9:00")).toBe(false);
    expect(isValidLocalTime("15:60")).toBe(false);
  });
});

describe("stayPhase", () => {
  const window = stayWindow({
    checkIn: "2026-09-12",
    checkOut: "2026-09-18",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    timeZone: "Europe/Warsaw",
  });

  it("is BEFORE_STAY right up to the check-in hour", () => {
    expect(stayPhase(window, new Date("2026-09-12T12:59:00Z"))).toBe("BEFORE_STAY");
  });

  it("turns IN_STAY exactly at check-in, local time", () => {
    expect(stayPhase(window, new Date("2026-09-12T13:00:00Z"))).toBe("IN_STAY");
  });

  it("is AFTER_STAY from the check-out hour", () => {
    expect(stayPhase(window, new Date("2026-09-18T08:59:00Z"))).toBe("IN_STAY");
    expect(stayPhase(window, new Date("2026-09-18T09:00:00Z"))).toBe("AFTER_STAY");
  });
});

describe("hoursBefore", () => {
  it("counts back from an instant", () => {
    const checkIn = zonedTimeToUtc("2026-09-12", "15:00", "Europe/Madrid");
    expect(hoursBefore(checkIn, 24).toISOString()).toBe("2026-09-11T13:00:00.000Z");
    expect(hoursBefore(checkIn, 6).toISOString()).toBe("2026-09-12T07:00:00.000Z");
  });
});
