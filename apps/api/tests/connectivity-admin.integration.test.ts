import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  adminActions,
  bookings,
  externalInventoryConnections,
  externalReservationMappings,
} from "../src/infrastructure/database/schema";
import { ConnectionsService } from "../src/modules/connectivity/application/connections.service";
import { InboundReservationsService } from "../src/modules/connectivity/application/inbound-reservations.service";
import { MappingsService } from "../src/modules/connectivity/application/mappings.service";
import { OutboundReservationsService } from "../src/modules/connectivity/application/outbound-reservations.service";
import {
  DATABASE,
  cleanupHosts,
  clearConnectivity,
  clearFinancials,
  createPublishedProperty,
  createTestApp,
  grantRole,
  registerGuest,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";
import { FakeHostawayProvider } from "./helpers/fake-hostaway";
import { FakePaymentProvider, signedEvent } from "./helpers/fake-payment-provider";

let app: NestFastifyApplication;
let database: Database;
let hostaway: FakeHostawayProvider;
let payments: FakePaymentProvider;

let connections: ConnectionsService;
let mappings: MappingsService;
let inbound: InboundReservationsService;
let outbound: OutboundReservationsService;

let admin: TestHost;
let host: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let connectionId: string;
let counter = 0;
const nextKey = () => `admin-conn-${Date.now()}-${(counter += 1)}`;

const LISTING = "66001";

function reservation(id: string, checkIn: string, checkOut: string) {
  return {
    externalId: id,
    externalListingId: LISTING,
    checkIn,
    checkOut,
    status: "ACTIVE" as const,
    guestName: "Gość z kanału",
    guestCount: 2,
    channel: "booking.com",
  };
}

async function paidBooking(checkIn: string, checkOut: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId: property.id,
      checkIn,
      checkOut,
      adults: 2,
      guest: { name: "Anna Nowak", email: "anna@example.com" },
    },
  });
  expect(response.statusCode).toBe(201);

  const reference = response.json().reference as string;
  const token = response.cookies.find((c) => c.name === "rezervio_booking_access")!.value;

  const started = await app.inject({
    method: "POST",
    url: `/api/bookings/${reference}/payment`,
    cookies: { rezervio_booking_access: token },
  });

  const { payload, signature } = signedEvent({
    id: `evt_${Math.random().toString(36).slice(2, 14)}`,
    type: "payment_intent.succeeded",
    payment: {
      providerPaymentId: payments.intentFor(started.json().paymentId)!,
      amountMinor: started.json().amountMinor,
      currency: "PLN",
      status: "SUCCEEDED",
    },
  });
  await app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });

  const [row] = await database.db
    .select()
    .from(bookings)
    .where(eq(bookings.publicReference, reference));

  return { id: row.id, reference };
}

async function issues(category = "INTEGRATION") {
  const response = await app.inject({
    method: "GET",
    url: `/api/admin/operations?category=${category}&limit=200`,
    cookies: admin.cookies,
  });

  expect(response.statusCode).toBe(200);
  return response.json().items as {
    type: string;
    severity: string;
    targetId: string;
    actions: string[];
    bookingId: string | null;
  }[];
}

beforeAll(async () => {
  hostaway = new FakeHostawayProvider();
  payments = new FakePaymentProvider();

  app = await createTestApp({
    emailProvider: new FakeEmailProvider(),
    paymentProvider: payments,
    inventoryProvider: hostaway,
  });

  database = app.get<Database>(DATABASE);
  connections = app.get(ConnectionsService);
  mappings = app.get(MappingsService);
  inbound = app.get(InboundReservationsService);
  outbound = app.get(OutboundReservationsService);

  admin = await registerGuest(app, "connadmin");
  host = await registerHost(app, "connhost");
  created.push(admin, host);
  await grantRole(database, admin.userId, "ADMIN");

  property = await createPublishedProperty(app, host, "Admin Conn Loft", {
    bookingMode: "INSTANT_BOOK",
  });
});

afterAll(async () => {
  await database.db.execute(sql`DELETE FROM admin_actions`);
  await clearConnectivity(database);
  await clearFinancials(database);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM availability_blocks`);
  await database.db.execute(sql`DELETE FROM booking_holds`);
  await database.db.execute(sql`DELETE FROM booking_events`);
  await database.db.execute(sql`DELETE FROM bookings`);
  await cleanupHosts(database, created);
  await app.close();
});

beforeEach(async () => {
  hostaway.reset();
  hostaway.setListings([{ externalId: LISTING, name: "Admin Conn Loft", address: null }]);
  hostaway.setReservations([]);

  await database.db.execute(sql`DELETE FROM admin_actions`);
  await clearConnectivity(database);
  await database.db.execute(sql`DELETE FROM availability_blocks`);

  const connection = await connections.upsert({
    hostId: host.hostId,
    provider: "HOSTAWAY",
    credentials: { accountId: "admin-conn", apiKey: "sekret-admin-1234" },
    externalAccountId: "admin-conn",
    status: "CONNECTED",
  });
  connectionId = connection.id;

  await mappings.create({
    connectionId,
    hostId: host.hostId,
    propertyId: property.id,
    externalPropertyId: LISTING,
    externalPropertyName: "Admin Conn Loft",
  });
});

describe("admin visibility", () => {
  it("lists connections with the numbers that say whether they work", async () => {
    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("adm-1", "2034-06-10", "2034-06-14"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/integrations",
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    const row = response.json().items.find((item: { id: string }) => item.id === connectionId);

    expect(row).toMatchObject({
      provider: "HOSTAWAY",
      status: "CONNECTED",
      hostDisplayName: "Test connhost",
      mappedProperties: 1,
      inboundReservations: 1,
      pendingOutbound: 0,
    });
  });

  /** Not the ciphertext, not a masked fragment. Nothing (milestone 12 §25). */
  it("never exposes credentials in any form", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/integrations",
      cookies: admin.cookies,
    });

    expect(response.body).not.toContain("sekret-admin-1234");
    expect(response.body).not.toContain("credentials");
    expect(response.body).not.toContain("v1.");
  });

  it("puts connections on the dashboard", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
      cookies: admin.cookies,
    });

    expect(
      response.json().integrations.some((item: { id: string }) => item.id === connectionId),
    ).toBe(true);
  });

  it("refuses the integrations view to a Host", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/integrations",
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("ADMIN_FORBIDDEN");
  });
});

describe("operational issues", () => {
  /**
   * The serious one: the Stay is sold and paid for, and the other channels do
   * not know (milestone 12 §30).
   */
  it("shows a confirmed Booking that never reached the provider", async () => {
    const booking = await paidBooking("2034-07-10", "2034-07-14");
    hostaway.failNext(1);

    await expect(outbound.pushBooking(booking.id)).rejects.toThrow();

    const found = await issues();
    const issue = found.find((item) => item.type === "OUTBOUND_SYNC_FAILED");

    expect(issue).toBeDefined();
    expect(issue!.bookingId).toBe(booking.id);
    expect(issue!.actions).toContain("RETRY_OUTBOUND_RESERVATION");

    // And the Booking is untouched.
    const [after] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(after.status).toBe("CONFIRMED");
  });

  it("shows a degraded connection", async () => {
    await connections.recordOutcome(connectionId, {
      ok: false,
      errorCode: "PROVIDER_UNAVAILABLE",
    });

    const issue = (await issues()).find((item) => item.type === "INTEGRATION_SYNC_FAILED");

    expect(issue).toMatchObject({ severity: "WARNING", targetId: connectionId });
    expect(issue!.actions).toContain("RETRY_INTEGRATION_SYNC");
  });

  it("shows a connection that needs something done outside Rezervio", async () => {
    await connections.upsert({
      hostId: host.hostId,
      provider: "CHANNEX",
      status: "ACTION_REQUIRED",
      statusReason: "PARTNER_ACCESS_REQUIRED",
    });

    const issue = (await issues()).find(
      (item) => item.type === "INTEGRATION_ACTION_REQUIRED",
    );

    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("FAILED");
  });

  /** Two systems, one set of nights. Somebody has to decide (milestone 12 §29). */
  it("shows an external reservation clashing with a confirmed Booking", async () => {
    const booking = await paidBooking("2034-08-10", "2034-08-14");
    void booking;

    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("clash", "2034-08-11", "2034-08-13"),
    });

    const issue = (await issues()).find(
      (item) => item.type === "EXTERNAL_RESERVATION_CONFLICT",
    );

    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("FAILED");
  });

  it("does not flag a healthy connection", async () => {
    await connections.recordOutcome(connectionId, { ok: true });

    expect(
      (await issues()).some(
        (item) =>
          item.targetId === connectionId &&
          (item.type === "INTEGRATION_SYNC_FAILED" ||
            item.type === "INTEGRATION_ACTION_REQUIRED"),
      ),
    ).toBe(false);
  });
});

describe("safe admin actions", () => {
  it("re-queues a sync and audits who asked", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-integration-sync",
      cookies: admin.cookies,
      payload: { connectionId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("SUCCEEDED");

    const [audited] = await database.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, connectionId));

    expect(audited).toMatchObject({
      actionType: "RETRY_INTEGRATION_SYNC",
      targetType: "CONNECTION",
      status: "SUCCEEDED",
    });
  });

  it("runs reconciliation through the normal command and reports what it did", async () => {
    hostaway.setReservations([reservation("rec-1", "2034-09-10", "2034-09-14")]);
    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("rec-1", "2034-09-10", "2034-09-14"),
    });

    // Cancelled at the provider; the webhook never arrived.
    hostaway.removeReservation("rec-1");

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/reconcile-integration",
      cookies: admin.cookies,
      payload: { connectionId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().details).toMatchObject({ processed: 1, cancelled: 1 });

    const [count] = (await database.db.execute(sql`
      SELECT count(*)::int AS total FROM availability_blocks
      WHERE property_id = ${property.id} AND source_type = 'EXTERNAL_PROVIDER'
    `)) as unknown as { total: number }[];

    expect(count.total).toBe(0);
  });

  it("retries an outbound push idempotently", async () => {
    const booking = await paidBooking("2034-10-10", "2034-10-14");
    hostaway.failNext(1);
    await outbound.pushBooking(booking.id).catch(() => undefined);

    const first = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-outbound-reservation",
      cookies: admin.cookies,
      payload: { bookingId: booking.id },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-outbound-reservation",
      cookies: admin.cookies,
      payload: { bookingId: booking.id },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Pressed twice, one reservation at the provider.
    expect(hostaway.created).toHaveLength(1);
  });

  it("disables a connection without losing its mappings or blocks", async () => {
    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("keep", "2034-11-10", "2034-11-14"),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/disable-integration",
      cookies: admin.cookies,
      payload: { connectionId },
    });

    expect(response.statusCode).toBe(200);

    const [connection] = await database.db
      .select()
      .from(externalInventoryConnections)
      .where(eq(externalInventoryConnections.id, connectionId));

    expect(connection.status).toBe("DISCONNECTED");
    expect(connection.statusReason).toBe("DISABLED_BY_ADMIN");

    // The blocks describe reservations that still exist at the provider.
    const [count] = (await database.db.execute(sql`
      SELECT count(*)::int AS total FROM availability_blocks
      WHERE property_id = ${property.id} AND source_type = 'EXTERNAL_PROVIDER'
    `)) as unknown as { total: number }[];
    expect(count.total).toBe(1);

    expect(
      await database.db
        .select()
        .from(externalReservationMappings)
        .where(eq(externalReservationMappings.connectionId, connectionId)),
    ).toHaveLength(1);
  });

  /**
   * There is no endpoint that writes a provider state by hand — no "mark
   * pushed", no "mark synced", no "set connection CONNECTED"
   * (milestone 12 §26, §48).
   */
  it("exposes no route that sets an external state directly", async () => {
    const document = await app.inject({ method: "GET", url: "/api/openapi.json" });
    const paths = Object.keys(document.json().paths as Record<string, unknown>);

    const connectivityActions = paths.filter((path) =>
      path.startsWith("/api/admin/actions/"),
    );

    expect(connectivityActions).toEqual(
      expect.arrayContaining([
        "/api/admin/actions/retry-integration-sync",
        "/api/admin/actions/reconcile-integration",
        "/api/admin/actions/disable-integration",
        "/api/admin/actions/retry-outbound-reservation",
      ]),
    );
    expect(connectivityActions.filter((path) => /mark|set-|force/i.test(path))).toEqual([]);
  });

  it("refuses every connectivity action to a Host", async () => {
    const actions: [string, Record<string, string>][] = [
      ["retry-integration-sync", { connectionId }],
      ["reconcile-integration", { connectionId }],
      ["disable-integration", { connectionId }],
      ["retry-outbound-reservation", { bookingId: crypto.randomUUID() }],
    ];

    for (const [path, payload] of actions) {
      const response = await app.inject({
        method: "POST",
        url: `/api/admin/actions/${path}`,
        cookies: host.cookies,
        payload,
      });
      expect(response.statusCode).toBe(403);
    }
  });
});
