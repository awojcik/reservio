import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseOrigins,
  stripeKeyMode,
  validateEnvironment,
} from "../src/infrastructure/security/env-validation";
import { environmentNameOf, isProductionLike } from "../src/infrastructure/security/app-environment";
import { cookieOptionsFor } from "../src/infrastructure/security/cookie-options";
import { normaliseRequestId } from "../src/infrastructure/security/request-context";
import { redactUrl, redactValue } from "../src/infrastructure/security/redaction";
import { maskEmail } from "../src/modules/admin/masking";

/** A configuration that a staging deployment would actually pass. */
const PRODUCTION_LIKE = {
  APP_ENV: "staging",
  DATABASE_URL: "postgresql://user:pass@db/rezervio",
  REDIS_URL: "redis://cache:6379",
  WEB_ORIGIN: "https://rezervio.pl",
  APP_BASE_URL: "https://rezervio.pl",
  ICAL_URL_ENCRYPTION_KEY: "a".repeat(44),
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
};

describe("environment names", () => {
  it("treats staging as production-like and development as not", () => {
    expect(environmentNameOf({ APP_ENV: "staging" })).toBe("staging");
    expect(isProductionLike("staging")).toBe(true);
    expect(isProductionLike("development")).toBe(false);
  });

  it("falls back to development for an unrecognised value", () => {
    // An unfamiliar name must never quietly grant production relaxations.
    expect(environmentNameOf({ APP_ENV: "preprod-2" })).toBe("development");
  });

  it("prefers APP_ENV over NODE_ENV", () => {
    expect(environmentNameOf({ APP_ENV: "production", NODE_ENV: "development" })).toBe(
      "production",
    );
  });
});

describe("Stripe key guard", () => {
  it("recognises test, live and unset keys", () => {
    expect(stripeKeyMode("sk_test_123")).toBe("TEST");
    expect(stripeKeyMode("rk_test_123")).toBe("TEST");
    expect(stripeKeyMode("sk_live_123")).toBe("LIVE");
    expect(stripeKeyMode("rk_live_123")).toBe("LIVE");
    expect(stripeKeyMode("")).toBe("UNSET");
    expect(stripeKeyMode(undefined)).toBe("UNSET");
    // The placeholder the provider module falls back to is not a real key.
    expect(stripeKeyMode("sk_test_unset")).toBe("UNSET");
  });

  it("accepts a test key in development", () => {
    const result = validateEnvironment({ NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_test_x" });
    expect(result.stripe).toBe("TEST");
    expect(result.name).toBe("development");
  });

  it("refuses to start on a live key in development", () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_live_x" }),
    ).toThrow(EnvironmentValidationError);
  });

  it("refuses to start on a live key in test", () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_live_x" }),
    ).toThrow(EnvironmentValidationError);
  });

  /**
   * Milestone 11 is explicitly not the go-live decision, so production is not
   * an escape hatch either: a live key stops the process everywhere.
   */
  it("refuses to start on a live key even in production", () => {
    expect(() =>
      validateEnvironment({ ...PRODUCTION_LIKE, STRIPE_SECRET_KEY: "sk_live_x" }),
    ).toThrow(EnvironmentValidationError);
  });

  it("warns rather than fails when no key is configured", () => {
    const result = validateEnvironment({ ...PRODUCTION_LIKE, STRIPE_SECRET_KEY: "" });
    expect(result.stripe).toBe("UNSET");
    expect(result.warnings.join(" ")).toContain("STRIPE_SECRET_KEY");
  });
});

describe("environment validation", () => {
  it("passes a complete production-like configuration", () => {
    const result = validateEnvironment(PRODUCTION_LIKE);
    expect(result.productionLike).toBe(true);
    expect(result.allowedOrigins).toEqual(["https://rezervio.pl"]);
  });

  it("rejects a missing secret in production", () => {
    expect(() =>
      validateEnvironment({ ...PRODUCTION_LIKE, ICAL_URL_ENCRYPTION_KEY: "" }),
    ).toThrow(/ICAL_URL_ENCRYPTION_KEY/);
  });

  it("rejects a wildcard or plain-http origin in production", () => {
    expect(() => validateEnvironment({ ...PRODUCTION_LIKE, WEB_ORIGIN: "*" })).toThrow(
      /WEB_ORIGIN/,
    );
    expect(() =>
      validateEnvironment({ ...PRODUCTION_LIKE, WEB_ORIGIN: "http://rezervio.pl" }),
    ).toThrow(/https/);
  });

  it("leaves development permissive", () => {
    const result = validateEnvironment({ NODE_ENV: "development" });
    expect(result.allowedOrigins).toEqual(["http://localhost:3000"]);
  });

  it("never produces a wildcard origin", () => {
    expect(parseOrigins("*", ["http://localhost:3000"])).toEqual(["http://localhost:3000"]);
    expect(parseOrigins("https://a.pl, https://b.pl/", [])).toEqual([
      "https://a.pl",
      "https://b.pl",
    ]);
  });
});

describe("cookie hardening", () => {
  it("sets Secure in production-like environments and not on localhost", () => {
    expect(cookieOptionsFor("production", 60)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
    expect(cookieOptionsFor("staging", 60).secure).toBe(true);
    // A Secure cookie over plain-HTTP localhost is silently dropped.
    expect(cookieOptionsFor("development", 60).secure).toBe(false);
    expect(cookieOptionsFor("test", 60).secure).toBe(false);
  });
});

describe("log redaction", () => {
  it("removes values that look like provider credentials", () => {
    expect(redactValue({ note: "key sk_live_abcdefgh here" })).toEqual({
      note: "key [redacted] here",
    });
    expect(redactValue({ note: "whsec_abcdefgh" })).toEqual({ note: "[redacted]" });
    expect(redactValue({ note: "pi_123_secret_xyz" })).toEqual({ note: "[redacted]" });
  });

  it("removes values under a sensitive key whatever they contain", () => {
    expect(
      redactValue({ accessCode: "4821", wifiPassword: "kot", nested: { password: "x" } }),
    ).toEqual({
      accessCode: "[redacted]",
      wifiPassword: "[redacted]",
      nested: { password: "[redacted]" },
    });
  });

  it("leaves ordinary operational fields alone", () => {
    expect(redactValue({ bookingId: "abc", attempts: 3 })).toEqual({
      bookingId: "abc",
      attempts: 3,
    });
  });

  it("masks credentials carried inside a URL", () => {
    expect(redactUrl("/api/calendar/ical/abcdef123.ics")).toBe(
      "/api/calendar/ical/[redacted].ics",
    );
    expect(redactUrl("/api/admin/search?q=anna@example.com")).toBe(
      "/api/admin/search?q=[redacted]",
    );
    expect(redactUrl("/api/host/bookings?search=Nowak&limit=10")).toBe(
      "/api/host/bookings?search=[redacted]&limit=10",
    );
  });

  it("survives a deeply nested object without recursing forever", () => {
    let deep: Record<string, unknown> = { password: "x" };
    for (let index = 0; index < 20; index += 1) deep = { deep };
    expect(() => redactValue(deep)).not.toThrow();
  });
});

describe("correlation ids", () => {
  it("reuses a well-formed caller id and replaces anything else", () => {
    expect(normaliseRequestId("req-abcdef12")).toBe("req-abcdef12");
    expect(normaliseRequestId("short")).not.toBe("short");
    expect(normaliseRequestId("has spaces and ;")).toMatch(/^[0-9a-f-]{36}$/);
    expect(normaliseRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("email masking", () => {
  it("keeps the domain recognisable and hides the mailbox", () => {
    expect(maskEmail("anna.nowak@example.com")).toBe("a*****@example.com");
    expect(maskEmail("ab@example.com")).toBe("a**@example.com");
    expect(maskEmail(null)).toBe("—");
  });
});
