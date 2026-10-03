import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { PaymentProviderExceptionFilter } from "../src/infrastructure/security/provider-error.filter";
import { PaymentProviderError } from "../src/modules/payments/domain/payment-provider";
import { DATABASE, cleanupUsers, createTestApp, registerGuest, TEST_PASSWORD } from "./helpers/host-fixture";

let app: NestFastifyApplication;
let database: Database;
const created: { userId: string }[] = [];

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
});

afterAll(async () => {
  await cleanupUsers(database, created);
  await app.close();
});

describe("security headers", () => {
  it("sends the hardening headers on every response", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(String(response.headers["content-security-policy"])).toContain(
      "frame-ancestors 'none'",
    );
    expect(String(response.headers["permissions-policy"])).toContain("camera=()");
  });

  /**
   * HSTS from a plain-HTTP dev server teaches the browser to refuse localhost
   * over HTTP for months — a self-inflicted outage on every developer machine
   * (milestone 11 §23).
   */
  it("does not send HSTS outside a production-like environment", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  /**
   * The API's CSP governs Swagger UI, not Stripe Elements: Elements is
   * embedded by the web app, whose policy lives in `next.config.ts`. What
   * matters here is that the API sends no policy the web app inherits.
   */
  it("keeps its CSP to itself — the Stripe frame is the web app's concern", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    const policy = String(response.headers["content-security-policy"]);

    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toContain("js.stripe.com");
    // On plain HTTP it would rewrite every localhost call to https.
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});

describe("correlation ids", () => {
  it("returns a request id and reuses a well-formed one from the caller", async () => {
    const generated = await app.inject({ method: "GET", url: "/api/health" });
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const propagated = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-request-id": "trace-web-0001" },
    });
    expect(propagated.headers["x-request-id"]).toBe("trace-web-0001");
  });

  it("replaces a caller id that could poison a log line", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-request-id": "a\nb evil" },
    });

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("CORS", () => {
  it("reflects an allow-listed origin with credentials", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:3000" },
    });

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  /** Never `*` with credentials — that combination is refused by browsers anyway. */
  it("refuses an origin outside the allowlist", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("cookie hardening", () => {
  it("issues the session cookie HttpOnly and SameSite=Lax", async () => {
    const email = `cookie-${Date.now()}@test.local`;
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(201);
    created.push({ userId: response.json().user.id });

    const raw = response.headers["set-cookie"];
    const header = Array.isArray(raw) ? raw.join(";") : String(raw);

    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    // Secure is environment-dependent; on plain-HTTP localhost it must be off
    // or the browser drops the cookie and login silently fails.
    expect(header).not.toContain("Secure");
  });
});

describe("origin protection", () => {
  it("rejects a cookie-bearing state-changing request from another origin", async () => {
    const guest = await registerGuest(app, "origin");
    created.push({ userId: guest.userId });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      cookies: guest.cookies,
      headers: { origin: "https://evil.example" },
      payload: { firstName: "Mallory" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("INVALID_ORIGIN");
  });

  it("rejects a request the browser itself labelled cross-site", async () => {
    const guest = await registerGuest(app, "fetchsite");
    created.push({ userId: guest.userId });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      cookies: guest.cookies,
      headers: { "sec-fetch-site": "cross-site" },
      payload: { firstName: "Mallory" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("allows the same request from the web app's own origin", async () => {
    const guest = await registerGuest(app, "sameorigin");
    created.push({ userId: guest.userId });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      cookies: guest.cookies,
      headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
      payload: { firstName: "Ada" },
    });

    expect(response.statusCode).toBe(200);
  });

  /**
   * The Stripe webhook carries no cookie and no Origin. Blocking it here would
   * lose payment events — the one failure this system must not have
   * (milestone 11 §20).
   */
  it("never blocks a cookie-free request such as the provider webhook", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: { id: "evt_test" },
    });

    // Rejected on the signature, not on the origin — which is the point.
    expect(response.statusCode).toBe(400);
    expect(response.json().code).not.toBe("INVALID_ORIGIN");
  });

  it("leaves reads alone whatever origin they claim", async () => {
    const guest = await registerGuest(app, "readorigin");
    created.push({ userId: guest.userId });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: guest.cookies,
      headers: { origin: "https://evil.example" },
    });

    // A cross-origin *read* is stopped by CORS in the browser, not by us; the
    // response simply carries no allow-origin header.
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("error taxonomy", () => {
  /**
   * A provider refusal is not a crash and must not look like one: 502 with a
   * stable code, so support can tell "Stripe said no" from "Rezervio fell
   * over" — and so a retry loop knows whether trying again is worth anything
   * (milestone 11 §15).
   */
  it("answers a provider failure with a code, not a bare 500", async () => {
    const filter = new PaymentProviderExceptionFilter();
    const captured: { status?: number; body?: Record<string, unknown> } = {};

    const reply = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      send(body: Record<string, unknown>) {
        captured.body = body;
      },
    };

    filter.catch(
      new PaymentProviderError("Nie udało się utworzyć konta rozliczeniowego.", "account_invalid"),
      { switchToHttp: () => ({ getResponse: () => reply }) } as never,
    );

    expect(captured.status).toBe(502);
    expect(captured.body).toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      providerCode: "account_invalid",
      retryable: false,
    });
  });
});

describe("login brute-force protection", () => {
  /**
   * Ten failures against one address, then a cooldown — and the cooldown reply
   * is byte-for-byte the reply a wrong password gets, so it cannot be used to
   * discover which addresses exist (milestone 11 §21).
   */
  it("locks one identifier after repeated failures without revealing it exists", async () => {
    const guest = await registerGuest(app, "bruteforce");
    created.push({ userId: guest.userId });

    const wrong = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: guest.email, password: "zupelnie-inne-haslo" },
      });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await wrong()).statusCode).toBe(401);
    }

    // The correct password now fails too — the account is in cooldown.
    const locked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: guest.email, password: TEST_PASSWORD },
    });

    expect(locked.statusCode).toBe(401);
    expect(locked.json().message).toBe("Nieprawidłowy email lub hasło.");
  });

  it("does not lock a different account from the same address", async () => {
    const other = await registerGuest(app, "unaffected");
    created.push({ userId: other.userId });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: other.email, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
  });
});
