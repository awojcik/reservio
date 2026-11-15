import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PAYMENT_MESSAGES,
  confirmErrorMessage,
  diagnosticsOf,
  startErrorMessage,
} from "@/lib/payment-errors";

describe("a failed card payment, in the Guest's words", () => {
  it("says a declined card was declined", () => {
    expect(confirmErrorMessage({ type: "card_error", code: "card_declined", decline_code: "generic_decline" })).toBe(
      PAYMENT_MESSAGES.declined,
    );
    expect(confirmErrorMessage({ type: "card_error", code: "card_declined", decline_code: "insufficient_funds" })).toBe(
      PAYMENT_MESSAGES.declined,
    );
  });

  it("asks for the extra confirmation 3-D Secure needs", () => {
    expect(confirmErrorMessage({ type: "invalid_request_error", code: "payment_intent_authentication_failure" })).toBe(
      PAYMENT_MESSAGES.authentication,
    );
    expect(confirmErrorMessage({ type: "card_error", code: "card_declined", decline_code: "authentication_required" })).toBe(
      PAYMENT_MESSAGES.authentication,
    );
  });

  it("points at the card details when they are wrong or incomplete", () => {
    expect(confirmErrorMessage({ type: "validation_error", code: "incomplete_number" })).toBe(PAYMENT_MESSAGES.details);
    expect(confirmErrorMessage({ type: "card_error", code: "incorrect_cvc" })).toBe(PAYMENT_MESSAGES.details);
    expect(confirmErrorMessage({ type: "card_error", code: "expired_card" })).toBe(PAYMENT_MESSAGES.details);
  });

  it("blames the connection, not the Guest, when the operator is unreachable", () => {
    expect(confirmErrorMessage({ type: "api_connection_error" })).toBe(PAYMENT_MESSAGES.connection);
  });

  it("falls back to a neutral message for anything else", () => {
    expect(confirmErrorMessage({ type: "api_error", code: "something_new" })).toBe(PAYMENT_MESSAGES.generic);
    expect(confirmErrorMessage({})).toBe(PAYMENT_MESSAGES.generic);
  });
});

describe("a payment Rezervio could not start", () => {
  it("explains an expired hold", () => {
    expect(startErrorMessage("BOOKING_HOLD_EXPIRED", 409)).toBe(PAYMENT_MESSAGES.expired);
  });

  it("explains a provider that refused or could not be reached", () => {
    expect(startErrorMessage(undefined, 502)).toBe(PAYMENT_MESSAGES.connection);
  });

  it("says nothing technical otherwise", () => {
    expect(startErrorMessage(undefined, 500)).toBe(PAYMENT_MESSAGES.generic);
  });
});

describe("what a failed attempt leaves for a developer", () => {
  it("keeps identifiers only", () => {
    const diagnostics = diagnosticsOf({
      type: "card_error",
      code: "card_declined",
      decline_code: "generic_decline",
      request_log_url: "https://dashboard.stripe.com/logs/req_123",
      payment_intent: { id: "pi_123" },
      // What must never travel further: the whole error carries the intent's
      // client secret.
      ...({ message: "Your card was declined.", client_secret: "pi_123_secret_abc" } as object),
    });

    expect(diagnostics).toEqual({
      type: "card_error",
      code: "card_declined",
      declineCode: "generic_decline",
      requestLogUrl: "https://dashboard.stripe.com/logs/req_123",
      paymentIntentId: "pi_123",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });
});

/**
 * Stripe runs in test mode, but Guests and Hosts must see the payment flow as
 * it will be in production. Every surface they can reach is scanned for words
 * that would give the environment away; the admin panel is deliberately not
 * in the list — that is where test mode belongs.
 */
describe("Guest and Host surfaces", () => {
  const ROOT = join(__dirname, "..");
  const SURFACES = [
    "components/booking",
    "components/property",
    "components/search",
    "components/account",
    "components/host",
    "app/booking",
    "app/property",
    "app/account",
    "app/host",
    "lib/payment-errors.ts",
  ];
  const FORBIDDEN = /sandbox|test mode|tryb test|testow|test card|4242|pk_test|sk_test|livemode|NEXT_PUBLIC_STRIPE/i;

  function files(path: string): string[] {
    const full = join(ROOT, path);
    if (statSync(full, { throwIfNoEntry: false }) === undefined) return [];
    if (statSync(full).isFile()) return [full];
    return readdirSync(full).flatMap((entry) => files(join(path, entry)));
  }

  /** What renders, not what explains: comments may talk about test mode. */
  function visibleSource(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("never mention test mode, a sandbox or test cards", () => {
    const offenders = SURFACES.flatMap(files)
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))
      .filter((file) => {
        // The key's *name* is read in code; only displayed text is checked.
        const source = visibleSource(readFileSync(file, "utf8")).replace(
          /process\.env\.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/g,
          "",
        );
        return FORBIDDEN.test(source.replace(/console\.(error|warn)\([^)]*\)/g, ""));
      })
      .map((file) => file.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});
