import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { hosts, userSessions, users } from "../src/infrastructure/database/schema";
import {
  DATABASE,
  TEST_PASSWORD,
  cleanupHosts,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";

/**
 * Auth is exercised through real HTTP against the real database — a mocked
 * session store would prove nothing about the guard that actually runs.
 * Requires the local database (`pnpm infra:start && pnpm db:migrate`).
 */
let app: NestFastifyApplication;
let database: Database;
const created: TestHost[] = [];

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
});

afterAll(async () => {
  await cleanupHosts(database, created);
  await app.close();
});

describe("auth", () => {
  it("register creates a User, a Host and a session cookie", async () => {
    const host = await registerHost(app, "register");
    created.push(host);

    expect(host.userId).toEqual(expect.any(String));
    expect(host.hostId).toEqual(expect.any(String));
    expect(host.cookies.rezervio_session.length).toBeGreaterThan(20);

    const sessions = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, host.userId));
    expect(sessions).toHaveLength(1);
  });

  it("stores the password as an Argon2id hash, never in the clear", async () => {
    const host = await registerHost(app, "hash");
    created.push(host);

    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, host.userId));

    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it("stores only a hash of the session token", async () => {
    const host = await registerHost(app, "token");
    created.push(host);

    const [session] = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, host.userId));

    expect(session.tokenHash).not.toBe(host.cookies.rezervio_session);
    expect(session.tokenHash).toHaveLength(64);
  });

  it("rejects a duplicate email", async () => {
    const host = await registerHost(app, "dup");
    created.push(host);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { displayName: "Ktoś inny", email: host.email, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(409);
  });

  it("rejects a password shorter than 10 characters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { displayName: "Ktoś", email: "krotkie@test.local", password: "krotkie" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("logs in with valid credentials", async () => {
    const host = await registerHost(app, "login");
    created.push(host);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: host.email, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().host.id).toBe(host.hostId);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const host = await registerHost(app, "same");
    created.push(host);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: host.email, password: "zupelnie-inne-haslo" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nie-ma-takiego@test.local", password: TEST_PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().message).toBe(unknownEmail.json().message);
  });

  it("GET /api/auth/me describes the signed-in User", async () => {
    const host = await registerHost(app, "me");
    created.push(host);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { id: host.userId, email: host.email },
      host: { id: host.hostId },
    });
  });

  it("GET /api/auth/me is 401 without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("logout invalidates the session and is safe to repeat", async () => {
    const host = await registerHost(app, "logout");
    created.push(host);

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: host.cookies,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: host.cookies,
    });
    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: host.cookies,
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(afterLogout.statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const host = await registerHost(app, "expired");
    created.push(host);

    // Backdate the session rather than waiting seven days for it.
    await database.db
      .update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userSessions.userId, host.userId));

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(401);
  });

  it("sets the session cookie as HttpOnly, SameSite=Lax and Path=/", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register/host",
      payload: {
        displayName: "Cookie Test",
        email: `cookie-${Date.now()}@test.local`,
        password: TEST_PASSWORD,
      },
    });

    created.push({
      email: response.json().user.email,
      userId: response.json().user.id,
      hostId: response.json().host.id,
      cookies: {},
    });

    const cookie = response.cookies.find((entry) => entry.name === "rezervio_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  });

  /**
   * One identity, two roles. A Host profile is something an account may have,
   * not a separate account (milestone 06 §1, §42).
   */
  it("creates a User without a Host profile on general registration", async () => {
    const email = `plain-${Date.now()}@test.local`;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: TEST_PASSWORD, firstName: "Anna", lastName: "Nowak" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body.user).toMatchObject({ email, firstName: "Anna", lastName: "Nowak" });
    expect(body.host).toBeNull();

    created.push({ email, userId: body.user.id, hostId: "", cookies: {} });

    const hostRows = await database.db
      .select()
      .from(hosts)
      .where(eq(hosts.userId, body.user.id));
    expect(hostRows).toHaveLength(0);
  });

  it("still creates a Host profile through Host registration", async () => {
    const host = await registerHost(app, "compat");
    created.push(host);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: host.cookies,
    });

    expect(response.json().host).toMatchObject({ id: host.hostId });
  });

  it("describes the same identity shape whichever way the account was made", async () => {
    const plain = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: `shape-${Date.now()}@test.local`, password: TEST_PASSWORD },
    });
    created.push({
      email: plain.json().user.email,
      userId: plain.json().user.id,
      hostId: "",
      cookies: {},
    });

    const cookie = plain.cookies.find((entry) => entry.name === "rezervio_session")!;
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { rezervio_session: cookie.value },
    });

    // host = null is a first-class answer, not an error.
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { firstName: null, lastName: null, phone: null, preferredLocale: null },
      host: null,
    });
  });
});
