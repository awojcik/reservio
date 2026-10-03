import { describe, expect, it } from "vitest";

import {
  BOOKING_MODE_CTA,
  BOOKING_STATUS_LABELS,
  formatCountdown,
  isAwaitingHost,
  isTerminal,
} from "../lib/booking";

describe("booking presentation", () => {
  it("labels every status the API can return", () => {
    for (const status of [
      "PENDING_HOST_APPROVAL",
      "PENDING_PAYMENT",
      "CONFIRMED",
      "CANCELLED",
      "EXPIRED",
      "COMPLETED",
    ]) {
      expect(BOOKING_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("uses a different call to action per booking mode", () => {
    expect(BOOKING_MODE_CTA.REQUEST_TO_BOOK).toBe("Wyślij prośbę");
    expect(BOOKING_MODE_CTA.INSTANT_BOOK).toBe("Zarezerwuj");
  });

  it("knows which statuses are waiting and which are final", () => {
    expect(isAwaitingHost("PENDING_HOST_APPROVAL")).toBe(true);
    expect(isAwaitingHost("PENDING_PAYMENT")).toBe(false);

    expect(isTerminal("EXPIRED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("PENDING_PAYMENT")).toBe(false);
  });
});

describe("countdown", () => {
  it("formats minutes and seconds", () => {
    expect(formatCountdown(9 * 60_000 + 5_000)).toBe("09:05");
    expect(formatCountdown(61_000)).toBe("01:01");
  });

  it("floors at zero rather than going negative", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});
