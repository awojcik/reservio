import type { OperationalBooking } from "@rezervio/api-client";
import { describe, expect, it } from "vitest";

import { formatTimeRemaining, guestCount } from "@/lib/host-operations";

const NOW = Date.parse("2026-09-12T10:00:00.000Z");

describe("formatTimeRemaining", () => {
  it("counts minutes when the deadline is close", () => {
    expect(formatTimeRemaining("2026-09-12T10:45:00.000Z", NOW)).toBe("zostało 45 min");
  });

  it("switches to hours, then to days", () => {
    expect(formatTimeRemaining("2026-09-12T16:00:00.000Z", NOW)).toBe("zostało 6 h");
    expect(formatTimeRemaining("2026-09-15T10:00:00.000Z", NOW)).toBe("zostało 3 dni");
  });

  it("says so once the deadline has passed", () => {
    expect(formatTimeRemaining("2026-09-12T09:59:00.000Z", NOW)).toBe("termin minął");
  });
});

describe("guestCount", () => {
  const booking: OperationalBooking = {
    id: "1",
    reference: "RZV-1",
    status: "CONFIRMED",
    propertyId: "p",
    propertyTitle: "Baltic Loft",
    guestName: "Jan",
    checkIn: "2026-09-12",
    checkOut: "2026-09-16",
    adults: 2,
    children: 0,
    totalAmountMinor: 100000,
    currency: "PLN",
    hostResponseDeadlineAt: null,
  };

  it("counts adults and children together", () => {
    expect(guestCount(booking)).toBe("2 gości");
    expect(guestCount({ ...booking, adults: 1 })).toBe("1 gość");
    expect(guestCount({ ...booking, adults: 2, children: 2 })).toBe("4 gości");
  });
});
