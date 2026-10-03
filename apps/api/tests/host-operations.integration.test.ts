import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  availabilityBlocks,
  bookingHolds,
  bookings,
  externalCalendars,
  properties,
} from "../src/infrastructure/database/schema";
import {
  DATABASE,
  clearFinancials,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";

let app: NestFastifyApplication;
let database: Database;
let host: TestHost;
let stranger: TestHost;
let alpha: { id: string; slug: string };
let beta: { id: string; slug: string };
let foreign: { id: string; slug: string };
const created: TestHost[] = [];

let keyCounter = 0;
const nextKey = () => `ops7-${Date.now()}-${(keyCounter += 1)}`;

/** Today in the Property timezone, matching what the service computes. */
function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function dashboard(who: TestHost = host) {
  const response = await app.inject({
    method: "GET",
    url: "/api/host/dashboard",
    cookies: who.cookies,
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function calendar(query: string, who: TestHost = host) {
  const response = await app.inject({
    method: "GET",
    url: `/api/host/calendar?${query}`,
    cookies: who.cookies,
  });
  return response;
}

async function request(propertyId: string, checkIn: string, checkOut: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId,
      checkIn,
      checkOut,
      adults: 2,
      guest: { name: "Jan Kowalski", email: "jan@example.com" },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().reference as string;
}

/** Booking rows the Payments milestone will eventually produce. */
async function makeConfirmed(propertyId: string, checkIn: string, checkOut: string) {
  const reference = await request(propertyId, checkIn, checkOut);
  await database.db
    .update(bookings)
    .set({ status: "CONFIRMED", confirmedAt: new Date() })
    .where(eq(bookings.publicReference, reference));
  return reference;
}

async function reset() {
  await database.db.delete(availabilityBlocks);
  await database.db.delete(bookingHolds);
  await clearFinancials(database);
  await database.db.delete(bookings);
  await database.db.delete(externalCalendars);
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);

  for (const property of [alpha, beta, foreign]) {
    await database.db
      .update(properties)
      .set({ status: "PUBLISHED", bookingMode: "REQUEST_TO_BOOK" })
      .where(eq(properties.id, property.id));
  }
}

beforeAll(async () => {
  app = await createTestApp({ emailProvider: new FakeEmailProvider() });
  database = app.get<Database>(DATABASE);

  host = await registerHost(app, "ops7-owner");
  stranger = await registerHost(app, "ops7-stranger");
  created.push(host, stranger);

  alpha = await createPublishedProperty(app, host, "Alpha Loft");
  beta = await createPublishedProperty(app, host, "Beta Villa");
  foreign = await createPublishedProperty(app, stranger, "Obiekt obcego gospodarza");
});

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await reset();
  await cleanupHosts(database, created);
  await app.close();
});

describe("dashboard", () => {
  it("answers the whole screen in one request", async () => {
    const body = await dashboard();

    expect(Object.keys(body).sort()).toEqual([
      "attention",
      "calendarSync",
      "pendingRequests",
      "properties",
      "today",
      "upcomingStays",
    ]);
  });

  it("shows a pending request as an action item", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    const body = await dashboard();

    expect(body.pendingRequests).toHaveLength(1);
    expect(body.pendingRequests[0].propertyTitle).toBe("Alpha Loft");

    const item = body.attention.find(
      (entry: { type: string }) => entry.type === "BOOKING_REQUEST_PENDING",
    );
    expect(item).toMatchObject({ severity: "ACTION" });
    expect(item.actionUrl).toContain("/host/bookings/");
  });

  it("promotes a request whose deadline is close", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() + 60_000) })
      .where(eq(bookings.propertyId, alpha.id));

    const body = await dashboard();

    expect(body.attention[0].type).toBe("BOOKING_REQUEST_EXPIRING_SOON");
  });

  it("sorts pending requests by the soonest deadline", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    await request(beta.id, "2029-08-20", "2029-08-24");

    const rows = await database.db.select().from(bookings);
    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() + 10 * 3_600_000) })
      .where(eq(bookings.id, rows[0].id));
    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() + 2 * 3_600_000) })
      .where(eq(bookings.id, rows[1].id));

    const body = await dashboard();
    expect(body.pendingRequests[0].reference).toBe(rows[1].publicReference);
  });

  it("lists today's arrivals and departures in the Property timezone", async () => {
    const now = localToday();

    await makeConfirmed(alpha.id, now, shift(now, 3));
    await makeConfirmed(beta.id, shift(now, -3), now);

    const body = await dashboard();

    expect(body.today.date).toBe(now);
    expect(body.today.arrivals.map((a: { propertyTitle: string }) => a.propertyTitle)).toEqual([
      "Alpha Loft",
    ]);
    expect(
      body.today.departures.map((d: { propertyTitle: string }) => d.propertyTitle),
    ).toEqual(["Beta Villa"]);
  });

  it("orders upcoming stays by arrival date", async () => {
    const now = localToday();
    await makeConfirmed(alpha.id, shift(now, 20), shift(now, 23));
    await makeConfirmed(beta.id, shift(now, 5), shift(now, 8));

    const body = await dashboard();

    expect(body.upcomingStays.map((s: { checkIn: string }) => s.checkIn)).toEqual([
      shift(now, 5),
      shift(now, 20),
    ]);
  });

  it("counts Properties by publication state", async () => {
    await database.db
      .update(properties)
      .set({ status: "SUSPENDED" })
      .where(eq(properties.id, beta.id));

    const body = await dashboard();

    expect(body.properties).toMatchObject({ total: 2, published: 1, suspended: 1 });
  });

  it("warns about a draft that cannot be published yet", async () => {
    const draft = await app.inject({
      method: "POST",
      url: "/api/host/properties",
      cookies: host.cookies,
      payload: { title: "Szkic operacyjny", propertyType: "APARTMENT" },
    });

    const body = await dashboard();
    const item = body.attention.find(
      (entry: { type: string }) => entry.type === "PROPERTY_NOT_READY_FOR_PUBLISH",
    );

    expect(item).toBeDefined();
    expect(item.propertyId).toBe(draft.json().id);

    await database.db.delete(properties).where(eq(properties.id, draft.json().id));
  });

  it("warns about a failed calendar sync", async () => {
    await database.db.insert(externalCalendars).values({
      propertyId: alpha.id,
      provider: "AIRBNB",
      name: "Airbnb Alpha",
      importUrlEncrypted: "v1.placeholder",
      lastErrorCode: "TIMEOUT",
      lastSyncFailedAt: new Date(),
    });

    const body = await dashboard();

    expect(body.calendarSync).toMatchObject({ active: 1, failed: 1, healthy: 0 });
    expect(
      body.attention.some((entry: { type: string }) => entry.type === "ICAL_SYNC_FAILED"),
    ).toBe(true);
  });

  it("raises no warning for a healthy calendar", async () => {
    await database.db.insert(externalCalendars).values({
      propertyId: alpha.id,
      provider: "AIRBNB",
      name: "Airbnb Alpha",
      importUrlEncrypted: "v1.placeholder",
      lastSyncSucceededAt: new Date(),
    });

    const body = await dashboard();

    expect(body.calendarSync).toMatchObject({ failed: 0, stale: 0, healthy: 1 });
    expect(
      body.attention.some((entry: { type: string }) => entry.type.startsWith("ICAL_")),
    ).toBe(false);
  });

  it("flags a calendar that has not refreshed in a long time", async () => {
    await database.db.insert(externalCalendars).values({
      propertyId: alpha.id,
      provider: "PMS",
      name: "PMS Alpha",
      importUrlEncrypted: "v1.placeholder",
      lastSyncSucceededAt: new Date(Date.now() - 7 * 86_400_000),
    });

    const body = await dashboard();

    expect(body.calendarSync.stale).toBe(1);
    expect(
      body.attention.some((entry: { type: string }) => entry.type === "ICAL_SYNC_STALE"),
    ).toBe(true);
  });

  it("shows nothing belonging to another Host", async () => {
    await request(foreign.id, "2029-08-10", "2029-08-14");

    const mine = await dashboard();

    expect(mine.pendingRequests).toHaveLength(0);
    expect(mine.properties.total).toBe(2);
    expect(
      mine.attention.every((entry: { propertyId: string | null }) =>
        entry.propertyId === null ? true : [alpha.id, beta.id].includes(entry.propertyId),
      ),
    ).toBe(true);
  });

  it("needs a Host profile", async () => {
    const response = await app.inject({ method: "GET", url: "/api/host/dashboard" });
    expect(response.statusCode).toBe(401);
  });
});

describe("unified calendar", () => {
  async function hostBlock(propertyId: string, startDate: string, endDate: string) {
    await app.inject({
      method: "POST",
      url: `/api/host/properties/${propertyId}/availability/block`,
      cookies: host.cookies,
      payload: { startDate, endDate, note: "Prywatna notatka" },
    });
  }

  it("groups every Property of the Host", async () => {
    const response = await calendar("from=2029-08-01&to=2029-09-01");

    expect(response.statusCode).toBe(200);
    expect(response.json().properties.map((p: { title: string }) => p.title)).toEqual([
      "Alpha Loft",
      "Beta Villa",
    ]);
  });

  it("shows a manual block with a human label", async () => {
    await hostBlock(alpha.id, "2029-08-12", "2029-08-16");

    const body = (await calendar("from=2029-08-01&to=2029-09-01")).json();
    const events = body.properties.find(
      (p: { id: string }) => p.id === alpha.id,
    ).events;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "HOST_BLOCK",
      label: "Ręczna blokada",
      startDate: "2029-08-12",
      endDate: "2029-08-16",
    });
  });

  it("shows an active hold and the Booking behind it", async () => {
    await database.db
      .update(properties)
      .set({ bookingMode: "INSTANT_BOOK" })
      .where(eq(properties.id, alpha.id));

    const reference = await request(alpha.id, "2029-08-20", "2029-08-24");

    const body = (await calendar("from=2029-08-01&to=2029-09-01")).json();
    const events = body.properties.find((p: { id: string }) => p.id === alpha.id).events;

    expect(events[0]).toMatchObject({
      type: "BOOKING_HOLD",
      label: "Tymczasowo zablokowane",
      bookingReference: reference,
      guestName: "Jan Kowalski",
    });
    expect(events[0].expiresAt).toEqual(expect.any(String));
  });

  it("drops a hold once it has expired", async () => {
    await database.db
      .update(properties)
      .set({ bookingMode: "INSTANT_BOOK" })
      .where(eq(properties.id, alpha.id));
    await request(alpha.id, "2029-08-20", "2029-08-24");

    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.propertyId, alpha.id));

    const body = (await calendar("from=2029-08-01&to=2029-09-01")).json();
    const events = body.properties.find((p: { id: string }) => p.id === alpha.id).events;

    // Availability already ignores it, so the calendar must not draw it either.
    expect(events).toHaveLength(0);
  });

  it("shows an external block without leaking the other platform's guest", async () => {
    const [external] = await database.db
      .insert(externalCalendars)
      .values({
        propertyId: beta.id,
        provider: "BOOKING",
        name: "Booking.com Beta",
        importUrlEncrypted: "v1.placeholder",
      })
      .returning();

    await database.db.execute(sql`
      INSERT INTO availability_blocks
        (property_id, source_type, date_range, external_calendar_id, external_event_uid)
      VALUES (${beta.id}, 'EXTERNAL_CALENDAR',
              daterange('2029-08-05'::date, '2029-08-09'::date, '[)'),
              ${external.id}, 'uid-1')
    `);

    const response = await calendar("from=2029-08-01&to=2029-09-01");
    const events = response
      .json()
      .properties.find((p: { id: string }) => p.id === beta.id).events;

    expect(events[0]).toMatchObject({
      type: "EXTERNAL_CALENDAR",
      label: "Niedostępne — Booking.com",
      guestName: null,
      bookingReference: null,
    });
  });

  it("filters down to one Property", async () => {
    await hostBlock(alpha.id, "2029-08-12", "2029-08-16");
    await hostBlock(beta.id, "2029-08-12", "2029-08-16");

    const body = (
      await calendar(`from=2029-08-01&to=2029-09-01&propertyId=${alpha.id}`)
    ).json();

    expect(body.properties).toHaveLength(1);
    expect(body.properties[0].id).toBe(alpha.id);
  });

  it("rejects an inverted or oversized range", async () => {
    expect((await calendar("from=2029-09-01&to=2029-08-01")).statusCode).toBe(400);
    expect((await calendar("from=2029-01-01&to=2031-01-01")).statusCode).toBe(400);
  });

  it("cannot be pointed at another Host's Property", async () => {
    await hostBlock(alpha.id, "2029-08-12", "2029-08-16");

    const body = (
      await calendar(`from=2029-08-01&to=2029-09-01&propertyId=${foreign.id}`)
    ).json();

    // Filtering by a foreign id yields nothing rather than leaking it.
    expect(body.properties).toHaveLength(0);
  });

  it("shows another Host only their own Properties", async () => {
    await hostBlock(alpha.id, "2029-08-12", "2029-08-16");

    const body = (await calendar("from=2029-08-01&to=2029-09-01", stranger)).json();

    expect(body.properties.map((p: { title: string }) => p.title)).toEqual([
      "Obiekt obcego gospodarza",
    ]);
  });
});

describe("host booking search and filters", () => {
  async function list(query: string, who: TestHost = host) {
    const response = await app.inject({
      method: "GET",
      url: `/api/host/bookings?${query}`,
      cookies: who.cookies,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("finds a Booking by its reference", async () => {
    const reference = await request(alpha.id, "2029-08-10", "2029-08-14");
    await request(beta.id, "2029-09-10", "2029-09-14");

    const page = await list(`search=${reference}`);

    expect(page.items).toHaveLength(1);
    expect(page.items[0].reference).toBe(reference);
  });

  it("finds a Booking by Guest name and email", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");

    expect((await list("search=kowalski")).items).toHaveLength(1);
    expect((await list("search=jan@example.com")).items).toHaveLength(1);
    expect((await list("search=nieistniejacy")).items).toHaveLength(0);
  });

  it("filters by Property and status", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    await request(beta.id, "2029-09-10", "2029-09-14");

    expect((await list(`propertyId=${alpha.id}`)).items).toHaveLength(1);
    expect((await list("status=PENDING_HOST_APPROVAL")).items).toHaveLength(2);
    expect((await list("status=CANCELLED")).items).toHaveLength(0);
  });

  it("filters by an overlapping date range", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    await request(beta.id, "2029-09-10", "2029-09-14");

    expect((await list("from=2029-08-01&to=2029-09-01")).items).toHaveLength(1);
    expect((await list("from=2029-08-01&to=2029-10-01")).items).toHaveLength(2);
  });

  it("paginates and reports the total", async () => {
    for (const month of ["08", "09", "10"]) {
      await request(alpha.id, `2029-${month}-10`, `2029-${month}-14`);
    }

    const first = await list("limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);

    const second = await list("limit=2&offset=2");
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it("puts requests needing a decision first", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    const decided = await request(beta.id, "2029-09-10", "2029-09-14");

    const [row] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.publicReference, decided));
    await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/reject`,
      cookies: host.cookies,
    });

    const page = await list("sort=ACTION_REQUIRED");
    expect(page.items[0].status).toBe("PENDING_HOST_APPROVAL");
  });

  it("never returns another Host's Bookings, whatever the filter", async () => {
    const foreignReference = await request(foreign.id, "2029-08-10", "2029-08-14");

    for (const query of [
      "",
      `search=${foreignReference}`,
      "search=kowalski",
      `propertyId=${foreign.id}`,
      "status=PENDING_HOST_APPROVAL",
    ]) {
      const page = await list(query);
      expect(page.items).toHaveLength(0);
    }
  });
});

describe("quick actions from the dashboard", () => {
  it("goes through the existing Booking commands", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");

    const before = await dashboard();
    const pending = before.pendingRequests[0];

    const accept = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${pending.id}/accept`,
      cookies: host.cookies,
    });
    expect(accept.statusCode).toBe(200);
    // Accepting takes a hold, exactly as the Bookings list does.
    expect(accept.json().status).toBe("PENDING_PAYMENT");

    const after = await dashboard();
    expect(after.pendingRequests).toHaveLength(0);
    expect(
      after.attention.some((entry: { type: string }) =>
        entry.type.startsWith("BOOKING_REQUEST"),
      ),
    ).toBe(false);
  });

  it("refuses a transition the state machine does not allow", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    const { pendingRequests } = await dashboard();
    const id = pendingRequests[0].id;

    await app.inject({
      method: "POST",
      url: `/api/host/bookings/${id}/reject`,
      cookies: host.cookies,
    });
    const again = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${id}/accept`,
      cookies: host.cookies,
    });

    expect(again.statusCode).toBe(409);
  });

  it("refuses another Host's Booking", async () => {
    await request(alpha.id, "2029-08-10", "2029-08-14");
    const { pendingRequests } = await dashboard();

    const response = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${pendingRequests[0].id}/accept`,
      cookies: stranger.cookies,
    });

    expect(response.statusCode).toBe(404);
  });
});
