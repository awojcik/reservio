import { describe, expect, it } from "vitest";

import {
  assertCapacity,
  canTransition,
  generateBookingReference,
  toBookingAmounts,
} from "../src/domain/booking";

describe("booking state transitions", () => {
  it("lets a request be accepted, rejected or expire", () => {
    expect(canTransition("PENDING_HOST_APPROVAL", "PENDING_PAYMENT")).toBe(true);
    expect(canTransition("PENDING_HOST_APPROVAL", "CANCELLED")).toBe(true);
    expect(canTransition("PENDING_HOST_APPROVAL", "EXPIRED")).toBe(true);
  });

  it("refuses to jump straight to CONFIRMED", () => {
    // CONFIRMED is reachable only through Payment, which is Milestone 05.
    expect(canTransition("PENDING_HOST_APPROVAL", "CONFIRMED")).toBe(false);
    expect(canTransition("PENDING_PAYMENT", "CONFIRMED")).toBe(true);
  });

  it("treats terminal states as terminal", () => {
    for (const target of ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"] as const) {
      expect(canTransition("CANCELLED", target)).toBe(false);
      expect(canTransition("EXPIRED", target)).toBe(false);
    }
  });
});

describe("capacity", () => {
  it("accepts a party that fits", () => {
    expect(() => assertCapacity({ adults: 2, children: 2 }, 4)).not.toThrow();
  });

  it("counts children towards the limit", () => {
    expect(() => assertCapacity({ adults: 3, children: 2 }, 4)).toThrow();
  });

  it("requires at least one adult", () => {
    expect(() => assertCapacity({ adults: 0, children: 2 }, 4)).toThrow();
  });
});

describe("booking reference", () => {
  it("is readable and free of ambiguous characters", () => {
    const reference = generateBookingReference();

    expect(reference).toMatch(/^RZV-[A-Z2-9]{8}$/);
    // No I/O/0/1: these get misread when quoted over the phone.
    expect(reference.slice(4)).not.toMatch(/[IO01]/);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, generateBookingReference));
    expect(seen.size).toBe(500);
  });
});

describe("amounts", () => {
  it("totals the parts and keeps the future fees separate", () => {
    const amounts = toBookingAmounts({
      accommodationAmountMinor: 180_000,
      cleaningFeeAmountMinor: 12_000,
      currency: "PLN",
    });

    expect(amounts).toEqual({
      accommodationAmountMinor: 180_000,
      cleaningFeeAmountMinor: 12_000,
      // Zero today, but stored as their own fields so introducing them later
      // does not require reinterpreting old rows.
      serviceFeeAmountMinor: 0,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      totalAmountMinor: 192_000,
      currency: "PLN",
    });
  });
});
