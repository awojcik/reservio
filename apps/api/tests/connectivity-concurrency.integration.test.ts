import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import { externalReservationMappings } from "../src/infrastructure/database/schema";
import { ConnectionsService } from "../src/modules/connectivity/application/connections.service";
import { InboundReservationsService } from "../src/modules/connectivity/application/inbound-reservations.service";
import { MappingsService } from "../src/modules/connectivity/application/mappings.service";
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
import { FakePaymentProvider } from "./helpers/fake-payment-provider";

let app: NestFastifyApplication;
let database: Database;
let connections: ConnectionsService;
let mappings: MappingsService;
let inbound: InboundReservationsService;

let host: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `race-${Date.now()}-${(counter += 1)}`;

const LISTING = "77001";
let connectionId: string;

async function bookingAttempt(checkIn: string, checkOut: string) {
  return app.inject({
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
}

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

async function blockCount(sourceType: string): Promise<number> {
  const [row] = (await database.db.execute(sql`
    SELECT count(*)::int AS total
    FROM availability_blocks
    WHERE property_id = ${property.id} AND source_type = ${sourceType}
  `)) as unknown as { total: number }[];

  return row?.total ?? 0;
}

beforeAll(async () => {
  app = await createTestApp({
    emailProvider: new FakeEmailProvider(),
    paymentProvider: new FakePaymentProvider(),
    inventoryProvider: new FakeHostawayProvider(),
  });

  database = app.get<Database>(DATABASE);
  connections = app.get(ConnectionsService);
  mappings = app.get(MappingsService);
  inbound = app.get(InboundReservationsService);

  host = await registerHost(app, "racehost");
  created.push(host);
  property = await createPublishedProperty(app, host, "Race Loft", {
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
  await clearConnectivity(database);
  await database.db.execute(sql`DELETE FROM availability_blocks`);
  await database.db.execute(sql`DELETE FROM booking_holds`);
  await database.db.execute(sql`DELETE FROM booking_events`);
  await database.db.execute(sql`DELETE FROM bookings`);

  const connection = await connections.upsert({
    hostId: host.hostId,
    provider: "HOSTAWAY",
    credentials: { accountId: "race", apiKey: "race-secret-value" },
    externalAccountId: "race",
    status: "CONNECTED",
  });
  connectionId = connection.id;

  await mappings.create({
    connectionId,
    hostId: host.hostId,
    propertyId: property.id,
    externalPropertyId: LISTING,
    externalPropertyName: "Race Loft",
  });
});

/**
 * The race the milestone calls mandatory: a Rezervio Booking being created
 * while an external reservation for the same nights arrives (milestone 12 §29).
 *
 * Both paths take the same `pg_advisory_xact_lock` on the Property, so
 * PostgreSQL serialises them. The winner is not fixed — that is the point —
 * but the outcome is always one of exactly two safe shapes:
 *
 * ```text
 * external first  → the Booking is refused, PROPERTY_NOT_AVAILABLE
 * Booking first   → the reservation is recorded and flagged as a conflict
 * ```
 *
 * What must never happen is the third shape: both sides succeeding quietly.
 */
describe("external reservation versus Rezervio Booking", () => {
  it("never lets both sides quietly take the same nights", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await database.db.execute(sql`DELETE FROM availability_blocks`);
      await database.db.execute(sql`DELETE FROM booking_holds`);
      await database.db.execute(sql`DELETE FROM booking_events`);
      await database.db.execute(sql`DELETE FROM bookings`);
      await database.db.execute(sql`DELETE FROM external_reservation_mappings`);

      const dates = { checkIn: "2033-01-10", checkOut: "2033-01-14" };

      // Fired together, on purpose: whichever reaches the lock first wins.
      const [booking, external] = await Promise.all([
        bookingAttempt(dates.checkIn, dates.checkOut),
        inbound.apply({
          connectionId,
          provider: "HOSTAWAY",
          propertyId: property.id,
          reservation: reservation(`race-${attempt}`, "2033-01-11", "2033-01-13"),
        }),
      ]);

      const bookingRefused = booking.statusCode === 409;
      const conflictFlagged = external.conflictsWithBooking;

      // One of the two must have happened. Both succeeding silently is the
      // failure this whole mechanism exists to prevent.
      expect(bookingRefused || conflictFlagged).toBe(true);

      if (bookingRefused) {
        expect(booking.json().code).toBe("PROPERTY_NOT_AVAILABLE");
      } else {
        expect(booking.statusCode).toBe(201);
      }

      // And exactly one external block, whichever way it went.
      expect(await blockCount("EXTERNAL_PROVIDER")).toBe(1);
    }
  });

  it("refuses a Booking for dates an external reservation already holds", async () => {
    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("held", "2033-02-10", "2033-02-16"),
    });

    const response = await bookingAttempt("2033-02-12", "2033-02-14");

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("PROPERTY_NOT_AVAILABLE");
  });

  /** Half-open ranges: a checkout is another Guest's check-in. */
  it("allows a Booking that starts the day an external reservation ends", async () => {
    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: reservation("touching", "2033-03-10", "2033-03-14"),
    });

    const response = await bookingAttempt("2033-03-14", "2033-03-18");
    expect(response.statusCode).toBe(201);
  });

  /**
   * Duplicate deliveries arriving at the same instant. The unique index on
   * `(connection, external reservation id)` is what settles it — not the order
   * the two transactions happen to reach the lock in (milestone 12 §35).
   */
  it("applies eight simultaneous copies of one reservation as one block", async () => {
    const payload = reservation("storm", "2033-04-10", "2033-04-14");

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        inbound.apply({
          connectionId,
          provider: "HOSTAWAY",
          propertyId: property.id,
          reservation: payload,
        }),
      ),
    );

    expect(outcomes).toHaveLength(8);
    expect(await blockCount("EXTERNAL_PROVIDER")).toBe(1);

    const rows = await database.db
      .select()
      .from(externalReservationMappings)
      .where(eq(externalReservationMappings.connectionId, connectionId));
    expect(rows).toHaveLength(1);

    // Exactly one of them did the creating.
    expect(outcomes.filter((outcome) => outcome.effect === "CREATED")).toHaveLength(1);
  });

  it("applies a cancellation and a duplicate cancellation as one release", async () => {
    const payload = reservation("cancel-storm", "2033-05-10", "2033-05-14");

    await inbound.apply({
      connectionId,
      provider: "HOSTAWAY",
      propertyId: property.id,
      reservation: payload,
    });

    const cancellations = await Promise.all(
      Array.from({ length: 4 }, () =>
        inbound.apply({
          connectionId,
          provider: "HOSTAWAY",
          propertyId: property.id,
          reservation: { ...payload, status: "CANCELLED" as const },
        }),
      ),
    );

    expect(cancellations.filter((outcome) => outcome.effect === "CANCELLED")).toHaveLength(1);
    expect(await blockCount("EXTERNAL_PROVIDER")).toBe(0);
  });
});
