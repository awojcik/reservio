import { describe, expect, it } from "vitest";

import {
  PROVIDER_DESCRIPTIONS,
  STATUS_LABELS,
  STATUS_REASON_LABELS,
  formatSyncTime,
  severityOfConnection,
} from "../lib/integrations";

describe("connection severity", () => {
  /**
   * Four visual states, and the mapping that decides which. A DEGRADED
   * connection is a warning, not a failure: the credentials work and the next
   * attempt may well succeed (milestone 12 §30).
   */
  it("maps every connection status onto the four-state scale", () => {
    expect(severityOfConnection("CONNECTED")).toBe("OK");
    expect(severityOfConnection("DEGRADED")).toBe("WARNING");
    expect(severityOfConnection("ACTION_REQUIRED")).toBe("FAILED");
    expect(severityOfConnection("DISCONNECTED")).toBe("FAILED");
    expect(severityOfConnection("PENDING")).toBe("PENDING");
    // Anything unrecognised is in progress rather than fine.
    expect(severityOfConnection("NOT_CONNECTED")).toBe("PENDING");
  });
});

describe("labels", () => {
  it("has a Polish label for every status the API can return", () => {
    for (const status of [
      "NOT_CONNECTED",
      "PENDING",
      "CONNECTED",
      "DEGRADED",
      "DISCONNECTED",
      "ACTION_REQUIRED",
    ]) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });

  /**
   * The partner-access wording has to say what is actually missing, not just
   * that something is (milestone 12 §21).
   */
  it("explains partner access in terms of the step that has not happened", () => {
    const text = STATUS_REASON_LABELS.PARTNER_ACCESS_REQUIRED;

    expect(text).toContain("staging");
    expect(text).toContain("certyfikacj");
  });

  /**
   * The two providers are different relationships, and the Host is told so —
   * treating them as interchangeable is the mistake this milestone is about
   * (milestone 12 §17).
   */
  it("describes the PMS and the channel manager as different relationships", () => {
    expect(PROVIDER_DESCRIPTIONS.HOSTAWAY).toContain("PMS");
    expect(PROVIDER_DESCRIPTIONS.CHANNEX).toContain("kanał");
    expect(PROVIDER_DESCRIPTIONS.CHANNEX).not.toBe(PROVIDER_DESCRIPTIONS.HOSTAWAY);
  });
});

describe("sync timestamps", () => {
  it("says 'nigdy' rather than showing an empty cell", () => {
    expect(formatSyncTime(null)).toBe("nigdy");
    expect(formatSyncTime(undefined)).toBe("nigdy");
    expect(formatSyncTime("2034-06-10T09:30:00.000Z")).toMatch(/2034/);
  });
});
