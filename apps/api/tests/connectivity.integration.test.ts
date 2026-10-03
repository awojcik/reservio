import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Queue } from "bullmq";

import type { Database } from "../src/infrastructure/database/connection";
import { EXTERNAL_QUEUE } from "../src/infrastructure/queue/queue.module";
import {
  availabilityBlocks,
  bookings,
  externalInventoryConnections,
  externalProviderEvents,
  externalPropertyMappings,
  externalReservationMappings,
} from "../src/infrastructure/database/schema";
import { ConnectionsService } from "../src/modules/connectivity/application/connections.service";
import { InboundReservationsService } from "../src/modules/connectivity/application/inbound-reservations.service";
import { InventorySyncService } from "../src/modules/connectivity/application/inventory-sync.service";
import { OutboundReservationsService } from "../src/modules/connectivity/application/outbound-reservations.service";
import { ProviderEventsService } from "../src/modules/connectivity/application/provider-events.service";
import { ProviderCredentialsCipher } from "../src/modules/connectivity/infrastructure/credentials.cipher";
import {
  DATABASE,
  cleanupHosts,
  clearConnectivity,
  clearFinancials,
  createPublishedProperty,
  createTestApp,
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
let inbound: InboundReservationsService;
let outbound: OutboundReservationsService;
let sync: InventorySyncService;
let events: ProviderEventsService;
let syncQueue: Queue;

let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
let strangerProperty: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `conn-${Date.now()}-${(counter += 1)}`;

const LISTING = "88001";
const STRANGER_LISTING = "88002";

async function connect(target = host, listing = LISTING) {
  const response = await app.inject({
    method: "POST",
    url: "/api/host/integrations/hostaway/connect",
    cookies: target.cookies,
    payload: { accountId: `acct-${target.hostId.slice(0, 8)}`, apiKey: "sekretny-klucz-1234" },
  });

  expect(response.statusCode).toBe(200);
  void listing;
  return response.json() as { integration: { id: string }; webhookSecret: string };
}

async function map(
  connectionId: string,
  target: TestHost,
  propertyId: string,
  externalId: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/host/integrations/${connectionId}/mappings`,
    cookies: target.cookies,
    payload: { propertyId, externalPropertyId: externalId, externalPropertyName: "Listing" },
  });

  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

/** Blocks on a Property, by source. */
async function blocksFor(propertyId: string, source = "EXTERNAL_PROVIDER") {
  return (await database.db.execute(sql`
    SELECT id::text AS id,
           lower(date_range)::text AS start_date,
           upper(date_range)::text AS end_date
    FROM availability_blocks
    WHERE property_id = ${propertyId} AND source_type = ${source}
    ORDER BY lower(date_range)
  `)) as unknown as { id: string; start_date: string; end_date: string }[];
}

/** A Booking taken all the way through payment. */
async function paidBooking(checkIn: string, checkOut: string) {
  const created_ = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId: property.id,
      checkIn,
      checkOut,
      adults: 2,
      guest: { name: "Ola Nowak", email: "ola@example.com" },
    },
  });
  expect(created_.statusCode).toBe(201);

  const reference = created_.json().reference as string;
  const token = created_.cookies.find((c) => c.name === "rezervio_booking_access")!.value;

  const started = await app.inject({
    method: "POST",
    url: `/api/bookings/${reference}/payment`,
    cookies: { rezervio_booking_access: token },
  });
  expect(started.statusCode).toBe(200);

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

  return { id: row.id, reference, token };
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
  inbound = app.get(InboundReservationsService);
  outbound = app.get(OutboundReservationsService);
  sync = app.get(InventorySyncService);
  events = app.get(ProviderEventsService);
  syncQueue = app.get<Queue>(EXTERNAL_QUEUE);

  host = await registerHost(app, "pmshost");
  stranger = await registerHost(app, "pmsstranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "PMS Loft", {
    bookingMode: "INSTANT_BOOK",
  });
  strangerProperty = await createPublishedProperty(app, stranger, "Stranger Loft", {
    bookingMode: "INSTANT_BOOK",
  });
});

afterAll(async () => {
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
  hostaway.setListings([
    { externalId: LISTING, name: "PMS Loft", address: "ul. Testowa 1" },
    { externalId: "88099", name: "Inny obiekt", address: null },
  ]);
  hostaway.setReservations([]);
  await clearConnectivity(database);
});

describe("connection", () => {
  it("verifies credentials at the provider before storing anything", async () => {
    hostaway.failNext(1, "CREDENTIALS_REJECTED", false);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/host/integrations/hostaway/connect",
      cookies: host.cookies,
      payload: { accountId: "acct-1", apiKey: "zly-klucz-123456" },
    });

    // A key that does not work must not leave a connection that looks fine and
    // silently syncs nothing.
    expect(rejected.statusCode).toBe(502);
    expect(
      await database.db.select().from(externalInventoryConnections),
    ).toHaveLength(0);

    const { integration } = await connect();
    expect(integration.id).toBeDefined();
    expect(hostaway.verified).toHaveLength(1);
  });

  /**
   * A provider API key is a working key to somebody's whole portfolio. It gets
   * the same treatment as a door code (milestone 12 §4, §38).
   */
  it("stores credentials encrypted and never returns them", async () => {
    const result = await connect();

    const [row] = await database.db
      .select()
      .from(externalInventoryConnections)
      .where(eq(externalInventoryConnections.id, result.integration.id));

    expect(row.credentialsEncrypted).not.toBeNull();
    expect(row.credentialsEncrypted).not.toContain("sekretny-klucz-1234");
    expect(row.credentialsEncrypted!.startsWith("v1.")).toBe(true);

    // And the round trip works: the adapter gets the real key back.
    const cipher = app.get(ProviderCredentialsCipher);
    expect(cipher.decrypt(row.credentialsEncrypted!).apiKey).toBe("sekretny-klucz-1234");

    const listed = await app.inject({
      method: "GET",
      url: "/api/host/integrations",
      cookies: host.cookies,
    });

    expect(listed.body).not.toContain("sekretny-klucz-1234");
    expect(listed.body).not.toContain("credentialsEncrypted");
  });

  it("is idempotent — reconnecting replaces the credentials, never adds a second row", async () => {
    await connect();
    await connect();

    const rows = await database.db
      .select()
      .from(externalInventoryConnections)
      .where(eq(externalInventoryConnections.hostId, host.hostId));

    expect(rows).toHaveLength(1);
  });

  it("shows a webhook URL the Host can paste into the provider", async () => {
    const { integration, webhookSecret } = await connect();

    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const listed = await app.inject({
      method: "GET",
      url: "/api/host/integrations",
      cookies: host.cookies,
    });

    const hostawayRow = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "HOSTAWAY");

    expect(hostawayRow.webhookUrl).toContain(`/webhooks/hostaway/${integration.id}`);
    // The secret is shown once, at connect time, and never again.
    expect(listed.body).not.toContain(webhookSecret);
  });
});

describe("property mapping", () => {
  it("lists provider listings with a suggestion the Host confirms", async () => {
    const { integration } = await connect();

    const response = await app.inject({
      method: "GET",
      url: `/api/host/integrations/${integration.id}/properties`,
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as {
      externalId: string;
      mapped: boolean;
      suggestedPropertyId: string | null;
    }[];

    // Exact title match is suggested — and is only a suggestion: nothing is
    // mapped until the Host says so.
    expect(items.find((item) => item.externalId === LISTING)?.suggestedPropertyId).toBe(
      property.id,
    );
    expect(items.find((item) => item.externalId === "88099")?.suggestedPropertyId).toBeNull();
    expect(items.every((item) => !item.mapped)).toBe(true);
  });

  it("maps a Property and refuses to map either side twice", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const again = await app.inject({
      method: "POST",
      url: `/api/host/integrations/${integration.id}/mappings`,
      cookies: host.cookies,
      payload: { propertyId: property.id, externalPropertyId: "88099" },
    });

    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("PROPERTY_ALREADY_MAPPED");
  });

  /**
   * A Host who names another Host's Property must not be able to map it —
   * the ownership question is answered on the server, not in the request
   * (milestone 12 §38).
   */
  it("refuses to map a Property belonging to another Host", async () => {
    const { integration } = await connect();

    const response = await app.inject({
      method: "POST",
      url: `/api/host/integrations/${integration.id}/mappings`,
      cookies: host.cookies,
      payload: { propertyId: strangerProperty.id, externalPropertyId: LISTING },
    });

    expect(response.statusCode).toBe(404);
  });

  it("keeps the blocks when a mapping is removed", async () => {
    const { integration } = await connect();
    const mapping = await map(integration.id, host, property.id, LISTING);

    await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-keep", "2031-03-01", "2031-03-05"),
    });

    expect(await blocksFor(property.id)).toHaveLength(1);

    await app.inject({
      method: "DELETE",
      url: `/api/host/integrations/${integration.id}/mappings/${mapping.id}`,
      cookies: host.cookies,
    });

    // Deleting them would free dates somebody has already sold elsewhere.
    expect(await blocksFor(property.id)).toHaveLength(1);
  });
});

describe("inbound reservations", () => {
  it("blocks the calendar and stops the dates being bookable", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const outcome = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-1", "2031-04-10", "2031-04-14"),
    });

    expect(outcome.effect).toBe("CREATED");

    const blocks = await blocksFor(property.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start_date: "2031-04-10", end_date: "2031-04-14" });

    // And it really is unavailable through the public API.
    const availability = await app.inject({
      method: "GET",
      url: `/api/properties/${property.slug}/availability?from=2031-04-01&to=2031-04-30`,
    });
    expect(availability.json().unavailableRanges).toContainEqual(
      expect.objectContaining({ startDate: "2031-04-10", endDate: "2031-04-14" }),
    );

    const booking = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "idempotency-key": nextKey() },
      payload: {
        propertyId: property.id,
        checkIn: "2031-04-11",
        checkOut: "2031-04-13",
        adults: 2,
        guest: { name: "Jan Kowalski", email: "jan@example.com" },
      },
    });

    expect(booking.statusCode).toBe(409);
    expect(booking.json().code).toBe("PROPERTY_NOT_AVAILABLE");
  });

  /**
   * The most important idempotency property in this milestone: providers
   * deliver at least once and replay by hand (milestone 12 §35).
   */
  it("applies the same reservation three times and produces one block", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const payload = reservation("r-dup", "2031-05-10", "2031-05-15");

    const first = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: payload,
    });
    const second = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: payload,
    });
    const third = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: payload,
    });

    expect(first.effect).toBe("CREATED");
    expect(second.effect).toBe("UNCHANGED");
    expect(third.effect).toBe("UNCHANGED");

    expect(await blocksFor(property.id)).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(externalReservationMappings)
        .where(eq(externalReservationMappings.connectionId, integration.id)),
    ).toHaveLength(1);
  });

  it("moves the block when the reservation dates change", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-move", "2031-06-10", "2031-06-14"),
    });

    const moved = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-move", "2031-06-12", "2031-06-16"),
    });

    expect(moved.effect).toBe("UPDATED");

    const blocks = await blocksFor(property.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start_date: "2031-06-12", end_date: "2031-06-16" });
  });

  it("frees the dates when the reservation is cancelled, and is safe twice", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-cancel", "2031-07-10", "2031-07-14"),
    });

    const cancelled = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: { ...reservation("r-cancel", "2031-07-10", "2031-07-14"), status: "CANCELLED" },
    });
    const again = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: { ...reservation("r-cancel", "2031-07-10", "2031-07-14"), status: "CANCELLED" },
    });

    expect(cancelled.effect).toBe("CANCELLED");
    expect(again.effect).toBe("UNCHANGED");
    expect(await blocksFor(property.id)).toHaveLength(0);

    // The dates are bookable again.
    const booking = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "idempotency-key": nextKey() },
      payload: {
        propertyId: property.id,
        checkIn: "2031-07-11",
        checkOut: "2031-07-13",
        adults: 2,
        guest: { name: "Jan Kowalski", email: "jan@example.com" },
      },
    });
    expect(booking.statusCode).toBe(201);
  });

  /**
   * A double sale is a fact, not something Rezervio can fix by blocking harder.
   * It is recorded and surfaced rather than silently absorbed
   * (milestone 12 §29).
   */
  it("flags an external reservation that lands on a confirmed Rezervio Booking", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const booking = await paidBooking("2031-08-10", "2031-08-14");
    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row.status).toBe("CONFIRMED");

    const outcome = await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-clash", "2031-08-11", "2031-08-13"),
    });

    expect(outcome.conflictsWithBooking).toBe(true);
    // The block is written anyway: those nights genuinely are taken.
    expect((await blocksFor(property.id)).length).toBeGreaterThan(0);
  });

  it("keeps one Host's reservations out of another Host's calendar", async () => {
    const mine = await connect(host);
    await map(mine.integration.id, host, property.id, LISTING);

    const theirs = await connect(stranger);
    await map(theirs.integration.id, stranger, strangerProperty.id, STRANGER_LISTING);

    await inbound.apply({
      connectionId: theirs.integration.id,
      provider: "HOSTAWAY",
      propertyId: strangerProperty.id,
      reservation: reservation("r-theirs", "2031-09-10", "2031-09-14"),
    });

    expect(await blocksFor(property.id)).toHaveLength(0);
    expect(await blocksFor(strangerProperty.id)).toHaveLength(1);
  });
});

describe("sync and reconciliation", () => {
  it("pulls reservations for every mapped listing", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    hostaway.setReservations([
      reservation("s-1", "2031-10-01", "2031-10-05"),
      reservation("s-2", "2031-10-10", "2031-10-12"),
      // A listing this Host has not mapped: not ours to act on.
      { ...reservation("s-3", "2031-10-20", "2031-10-22"), externalListingId: "88099" },
    ]);

    const connection = (await connections.byId(integration.id))!;
    const result = await sync.syncConnection(connection);

    expect(result.processed).toBe(2);
    expect(result.created).toBe(2);
    expect(await blocksFor(property.id)).toHaveLength(2);
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);
    hostaway.setReservations([reservation("s-idem", "2031-11-01", "2031-11-05")]);

    const connection = (await connections.byId(integration.id))!;
    await sync.syncConnection(connection);
    const second = await sync.syncConnection(connection);

    expect(second.created).toBe(0);
    expect(await blocksFor(property.id)).toHaveLength(1);
  });

  /**
   * The recovery path. A cancellation whose webhook was lost would otherwise
   * leave Rezervio blocking dates that are free, and nobody would find out
   * until a Guest failed to book them (milestone 12 §16).
   */
  it("reconciliation frees dates for a reservation the provider no longer has", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);
    hostaway.setReservations([reservation("s-lost", "2031-12-01", "2031-12-05")]);

    const connection = (await connections.byId(integration.id))!;
    await sync.syncConnection(connection);
    expect(await blocksFor(property.id)).toHaveLength(1);

    // Cancelled at the provider; the webhook never arrived.
    hostaway.removeReservation("s-lost");

    const result = await sync.reconcileConnection(connection);

    expect(result.cancelled).toBe(1);
    expect(await blocksFor(property.id)).toHaveLength(0);
  });

  it("records every sync attempt, including the failures", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const connection = (await connections.byId(integration.id))!;
    hostaway.failNext(1);

    // One listing failing does not abandon the whole connection.
    const result = await sync.syncConnection(connection);
    expect(result.failed).toBe(1);

    const attempts = await connections.recentAttempts(integration.id);
    const pull = attempts.find((attempt) => attempt.syncType === "INBOUND_RESERVATIONS");

    expect(pull).toBeDefined();
    expect(pull!.status).toBe("SUCCEEDED");
    expect(pull!.itemsFailed).toBe(1);

    // A failure of the whole call is recorded too, with its code.
    hostaway.failNext(5);
    await sync.discoverListings(connection).catch(() => undefined);

    const afterFailure = await connections.recentAttempts(integration.id);
    const discovery = afterFailure.find(
      (attempt) => attempt.syncType === "PROPERTY_DISCOVERY",
    );

    expect(discovery).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE" });
  });

  /**
   * A failed sync degrades a connection; it must not disconnect it. Losing the
   * credentials because a provider had a bad minute would make a Host
   * reconnect by hand for no reason (milestone 12 §30).
   */
  it("degrades rather than disconnects on a transient failure", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const connection = (await connections.byId(integration.id))!;
    hostaway.failNext(5);

    await sync.reconcileConnection(connection).catch(() => undefined);

    const [after] = await database.db
      .select()
      .from(externalInventoryConnections)
      .where(eq(externalInventoryConnections.id, integration.id));

    expect(["CONNECTED", "DEGRADED"]).toContain(after.status);
    expect(after.credentialsEncrypted).not.toBeNull();
  });
});

describe("outbound reservations", () => {
  it("pushes a confirmed Rezervio Booking to the provider", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const booking = await paidBooking("2032-01-10", "2032-01-14");
    const outcomes = await outbound.pushBooking(booking.id);

    expect(outcomes[0]).toMatchObject({ pushed: true });
    expect(hostaway.created).toHaveLength(1);
    expect(hostaway.created[0]).toMatchObject({
      externalListingId: LISTING,
      bookingReference: booking.reference,
      checkIn: "2032-01-10",
      checkOut: "2032-01-14",
    });

    const [mapping] = await database.db
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.bookingId, booking.id),
          eq(externalReservationMappings.direction, "OUTBOUND"),
        ),
      );

    expect(mapping.status).toBe("ACTIVE");
    expect(mapping.externalReservationId).not.toContain("pending:");
  });

  /**
   * The claim is what stops this. The fake provider deliberately mints a new
   * reservation on every call, exactly as the real one would
   * (milestone 12 §14, §35).
   */
  it("pushing twice creates one external reservation", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const booking = await paidBooking("2032-02-10", "2032-02-14");

    await outbound.pushBooking(booking.id);
    await outbound.pushBooking(booking.id);
    await outbound.pushBooking(booking.id);

    expect(hostaway.created).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(externalReservationMappings)
        .where(
          and(
            eq(externalReservationMappings.bookingId, booking.id),
            eq(externalReservationMappings.direction, "OUTBOUND"),
          ),
        ),
    ).toHaveLength(1);
  });

  it("does not push a Booking whose Property is not mapped", async () => {
    await connect();
    const booking = await paidBooking("2032-03-10", "2032-03-14");

    expect(await outbound.pushBooking(booking.id)).toEqual([
      { pushed: false, reason: "NOT_MAPPED" },
    ]);
    expect(hostaway.created).toHaveLength(0);
  });

  /**
   * The rule the milestone is emphatic about: a provider having a bad
   * afternoon does not undo a Stay the Guest paid for (milestone 12 §30).
   */
  it("leaves the Booking CONFIRMED when the push fails, and retries later", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const booking = await paidBooking("2032-04-10", "2032-04-14");
    hostaway.failNext(1);

    await expect(outbound.pushBooking(booking.id)).rejects.toThrow();

    const [after] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(after.status).toBe("CONFIRMED");

    // Visible as a pending push, and retryable.
    const pending = await outbound.pendingPushes();
    expect(pending.some((row) => row.bookingId === booking.id)).toBe(true);

    const retried = await outbound.pushBooking(booking.id);
    expect(retried[0]).toMatchObject({ pushed: true });
    expect(hostaway.created).toHaveLength(1);
  });

  it("cancels the external reservation when the Booking is cancelled", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const booking = await paidBooking("2032-05-10", "2032-05-14");
    await outbound.pushBooking(booking.id);

    const externalId = hostaway.created.length > 0 ? "9001" : "";
    void externalId;

    const first = await outbound.cancelBooking(booking.id);
    const second = await outbound.cancelBooking(booking.id);

    expect(first.cancelled).toBe(1);
    // Nothing left to cancel: the mapping is already CANCELLED.
    expect(second.cancelled).toBe(0);
    expect(hostaway.cancelled).toHaveLength(1);

    const [mapping] = await database.db
      .select()
      .from(externalReservationMappings)
      .where(
        and(
          eq(externalReservationMappings.bookingId, booking.id),
          eq(externalReservationMappings.direction, "OUTBOUND"),
        ),
      );

    // The mapping is kept: "pushed there, then cancelled" is history somebody
    // will need (milestone 12 §15).
    expect(mapping).toBeDefined();
    expect(mapping.status).toBe("CANCELLED");
  });

  it("writes the push intent into the outbox when a Booking is confirmed", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    const booking = await paidBooking("2032-06-10", "2032-06-14");

    const rows = (await database.db.execute(sql`
      SELECT type FROM outbox_events WHERE aggregate_id = ${booking.id}
    `)) as unknown as { type: string }[];

    // Committed with the confirmation itself, so it cannot be lost to a crash
    // between the commit and the enqueue.
    expect(rows.map((row) => row.type)).toContain("EXTERNAL_RESERVATION_PUSH");
  });
});

describe("provider events", () => {
  it("accepts an event once and treats a replay as a duplicate", async () => {
    const { integration } = await connect();

    const first = await events.accept({
      provider: "HOSTAWAY",
      connectionId: integration.id,
      providerEventId: "evt-1",
      eventType: "reservation.created:5",
      payload: { any: "thing" },
    });
    const replay = await events.accept({
      provider: "HOSTAWAY",
      connectionId: integration.id,
      providerEventId: "evt-1",
      eventType: "reservation.created:5",
      payload: { any: "thing" },
    });

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
    expect(replay.accepted && replay.eventId).toBe(first.accepted && first.eventId);

    expect(
      await database.db
        .select()
        .from(externalProviderEvents)
        .where(eq(externalProviderEvents.connectionId, integration.id)),
    ).toHaveLength(1);
  });

  /**
   * The payload is hashed, not kept. A diagnostics table is no place for
   * somebody's Guest data (milestone 12 §7).
   */
  it("stores a hash of the payload, never the payload", async () => {
    const { integration } = await connect();

    await events.accept({
      provider: "HOSTAWAY",
      connectionId: integration.id,
      providerEventId: "evt-hash",
      eventType: "reservation.created:6",
      payload: { guestName: "Anna Nowak", guestEmail: "anna@example.com" },
    });

    const [row] = await database.db
      .select()
      .from(externalProviderEvents)
      .where(eq(externalProviderEvents.providerEventId, "evt-hash"));

    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("anna@example.com");
    expect(JSON.stringify(row)).not.toContain("Anna Nowak");
  });

  it("processes an event by re-reading the reservation from the provider", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    hostaway.upsertReservation(reservation("evt-res", "2032-07-10", "2032-07-14"));

    const accepted = await events.accept({
      provider: "HOSTAWAY",
      connectionId: integration.id,
      providerEventId: "evt-process",
      eventType: "reservation.created:evt-res",
      payload: {},
    });

    expect(accepted.accepted).toBe(true);
    const result = await events.process(accepted.accepted ? accepted.eventId : "");

    expect(result.applied).toBe(true);
    expect(await blocksFor(property.id)).toHaveLength(1);

    // Processing twice is a no-op.
    const again = await events.process(accepted.accepted ? accepted.eventId : "");
    expect(again).toMatchObject({ applied: false, reason: "ALREADY_PROCESSED" });
    expect(await blocksFor(property.id)).toHaveLength(1);
  });
});

describe("webhook endpoint", () => {
  it("rejects a call without the configured basic-auth password", async () => {
    const { integration } = await connect();

    const anonymous = await app.inject({
      method: "POST",
      url: `/api/webhooks/hostaway/${integration.id}`,
      payload: { event: "reservation created", data: { id: 1 } },
    });
    expect(anonymous.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "POST",
      url: `/api/webhooks/hostaway/${integration.id}`,
      headers: {
        authorization: `Basic ${Buffer.from("rezervio:zle-haslo").toString("base64")}`,
      },
      payload: { event: "reservation created", data: { id: 1 } },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("accepts a signed-in delivery once and deduplicates the replay", async () => {
    const { integration, webhookSecret } = await connect();
    await map(integration.id, host, property.id, LISTING);
    hostaway.upsertReservation(reservation("wh-1", "2032-08-10", "2032-08-14"));

    const headers = {
      authorization: `Basic ${Buffer.from(`rezervio:${webhookSecret}`).toString("base64")}`,
    };
    const payload = { id: 77, event: "reservation created", data: { id: "wh-1" } };

    const first = await app.inject({
      method: "POST",
      url: `/api/webhooks/hostaway/${integration.id}`,
      headers,
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/webhooks/hostaway/${integration.id}`,
      headers,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true, duplicate: false });
    expect(replay.json()).toEqual({ received: true, duplicate: true });

    expect(
      await database.db
        .select()
        .from(externalProviderEvents)
        .where(eq(externalProviderEvents.connectionId, integration.id)),
    ).toHaveLength(1);
  });

  /** An unknown connection answers exactly as a wrong password does. */
  it("does not reveal whether a connection id exists", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: `/api/webhooks/hostaway/${crypto.randomUUID()}`,
      headers: { authorization: `Basic ${Buffer.from("rezervio:x").toString("base64")}` },
      payload: { event: "reservation created", data: { id: 1 } },
    });

    expect(unknown.statusCode).toBe(401);
  });
});

describe("manual sync", () => {
  it("queues a job instead of fetching on the request thread, and deduplicates", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    /*
     * Mapping a Property already queues a sync — a freshly mapped Property has
     * a calendar Rezervio has never seen — so this press joins the pending job
     * rather than adding a second one, and says so.
     */
    const joined = await app.inject({
      method: "POST",
      url: `/api/host/integrations/${integration.id}/sync`,
      cookies: host.cookies,
    });

    // 202: accepted, not done. The provider is never called on this thread.
    expect(joined.statusCode).toBe(202);
    expect(joined.json()).toMatchObject({ status: "QUEUED", queued: false });

    // Once that job is gone, a manual sync queues real work again.
    await (await syncQueue.getJob(`sync-${integration.id}`))!.remove();

    const queuedFresh = await app.inject({
      method: "POST",
      url: `/api/host/integrations/${integration.id}/sync`,
      cookies: host.cookies,
    });

    expect(queuedFresh.json()).toMatchObject({ queued: true });
    expect(await syncQueue.getJob(`sync-${integration.id}`)).toBeDefined();
  });

  /** A stuck button must not become a load test against somebody's PMS. */
  it("rate limits repeated manual syncs", async () => {
    const { integration } = await connect();

    const burst = await Promise.all(
      Array.from({ length: 15 }, () =>
        app.inject({
          method: "POST",
          url: `/api/host/integrations/${integration.id}/sync`,
          cookies: host.cookies,
        }),
      ),
    );

    expect(burst.some((response) => response.statusCode === 429)).toBe(true);
    expect(burst.find((response) => response.statusCode === 429)!.json().code).toBe(
      "RATE_LIMITED",
    );
  });
});

describe("cross-Host isolation", () => {
  it("refuses every route on another Host's connection", async () => {
    const mine = await connect(host);

    const routes: [string, string][] = [
      ["GET", `/api/host/integrations/${mine.integration.id}/properties`],
      ["POST", `/api/host/integrations/${mine.integration.id}/sync`],
      ["DELETE", `/api/host/integrations/${mine.integration.id}`],
    ];

    for (const [method, url] of routes) {
      const response = await app.inject({
        method: method as "GET",
        url,
        cookies: stranger.cookies,
      });
      // 404, never 403 — a 403 would confirm the connection exists.
      expect(response.statusCode).toBe(404);
    }
  });

  it("shows a Host only their own integrations", async () => {
    await connect(host);

    const response = await app.inject({
      method: "GET",
      url: "/api/host/integrations",
      cookies: stranger.cookies,
    });

    const items = response.json().items as { id: string | null }[];
    expect(items.every((item) => item.id === null)).toBe(true);
  });
});

describe("iCal coexistence", () => {
  /**
   * iCal stays supported. A Property connected both natively and by iCal is a
   * real possibility worth warning about — the same reservation would arrive
   * twice, once opaque and once with an id — but Rezervio does not switch
   * either off on its own (milestone 12 §31).
   */
  it("warns when the same Host also imports iCal feeds", async () => {
    await connect();

    const before = await app.inject({
      method: "GET",
      url: "/api/host/integrations",
      cookies: host.cookies,
    });
    expect(before.json().icalAlsoConnected).toBe(false);

    const calendar = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/external-calendars`,
      cookies: host.cookies,
      payload: {
        provider: "AIRBNB",
        name: "Feed",
        importUrl: "https://calendar.example.test/feed.ics",
      },
    });
    expect(calendar.statusCode).toBe(201);

    const after = await app.inject({
      method: "GET",
      url: "/api/host/integrations",
      cookies: host.cookies,
    });
    expect(after.json().icalAlsoConnected).toBe(true);

    await database.db.execute(sql`DELETE FROM external_calendars`);
  });

  it("keeps iCal blocks and provider blocks apart", async () => {
    const { integration } = await connect();
    await map(integration.id, host, property.id, LISTING);

    await inbound.apply({
      connectionId: integration.id,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("r-coexist", "2032-09-10", "2032-09-14"),
    });

    const rows = (await database.db.execute(sql`
      SELECT source_type, count(*)::int AS total
      FROM availability_blocks WHERE property_id = ${property.id}
      GROUP BY source_type
    `)) as unknown as { source_type: string; total: number }[];

    // Two different sources, two different lifecycles, never merged.
    expect(rows.find((row) => row.source_type === "EXTERNAL_PROVIDER")?.total).toBe(1);
    expect(rows.find((row) => row.source_type === "EXTERNAL_CALENDAR")).toBeUndefined();
  });
});

function reservation(id: string, checkIn: string, checkOut: string) {
  return {
    externalId: id,
    externalListingId: LISTING,
    checkIn,
    checkOut,
    status: "ACTIVE" as const,
    guestName: "Anna Nowak",
    guestCount: 2,
    channel: "airbnb",
  };
}

// Keeps the unused-import checker honest about tables referenced only in SQL.
void availabilityBlocks;
void externalPropertyMappings;
