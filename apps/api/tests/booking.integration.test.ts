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
import { BookingsService } from "../src/modules/bookings/bookings.service";
import {
  DATABASE,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";

let app: NestFastifyApplication;
let database: Database;
let bookingsService: BookingsService;
let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

const GUEST = { name: "Jan Kowalski", email: "jan@example.com", phone: "+48600100200" };

let keyCounter = 0;
const nextKey = () => `test-key-${Date.now()}-${(keyCounter += 1)}`;

async function setMode(mode: "REQUEST_TO_BOOK" | "INSTANT_BOOK") {
  await database.db
    .update(properties)
    .set({ bookingMode: mode })
    .where(eq(properties.id, property.id));
}

/** Scoped to this Property: the database also holds rows from other suites. */
async function ownBookings() {
  return database.db.select().from(bookings).where(eq(bookings.propertyId, property.id));
}

async function book(
  payload: Record<string, unknown> = {},
  key = nextKey(),
) {
  return app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": key },
    payload: {
      propertyId: property.id,
      checkIn: "2026-10-12",
      checkOut: "2026-10-16",
      adults: 2,
      children: 0,
      guest: GUEST,
      ...payload,
    },
  });
}

async function addHostBlock(startDate: string, endDate: string) {
  await app.inject({
    method: "POST",
    url: `/api/host/properties/${property.id}/availability/block`,
    cookies: host.cookies,
    payload: { startDate, endDate },
  });
}

async function reset() {
  await database.db.delete(availabilityBlocks).where(eq(availabilityBlocks.propertyId, property.id));
  await database.db.delete(bookingHolds).where(eq(bookingHolds.propertyId, property.id));
  await database.db.delete(bookings).where(eq(bookings.propertyId, property.id));
  await database.db.delete(externalCalendars).where(eq(externalCalendars.propertyId, property.id));
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
}

beforeAll(async () => {
  app = await createTestApp();
  database = app.get<Database>(DATABASE);
  bookingsService = app.get(BookingsService);

  host = await registerHost(app, "booking-owner");
  stranger = await registerHost(app, "booking-stranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "Obiekt rezerwacyjny", {
    capacity: { maxGuests: 4, bedrooms: 2, beds: 3, bathrooms: 1 },
  });
});

beforeEach(async () => {
  await reset();
  await setMode("REQUEST_TO_BOOK");
});

afterAll(async () => {
  await database.db.delete(bookings).where(eq(bookings.propertyId, property.id));
  await cleanupHosts(database, created);
  await app.close();
});

/**
 * The single most important guarantee of this milestone: two Guests racing for
 * the same nights must not both win (milestone 04 §48, §68).
 */
describe("double booking protection", () => {
  it("lets exactly one of two concurrent overlapping attempts succeed", async () => {
    await setMode("INSTANT_BOOK");

    // Fired together, so both are inside the API before either commits. The
    // advisory lock is what forces one to wait and then see the other's hold.
    const [first, second] = await Promise.all([
      book({ checkIn: "2026-10-12", checkOut: "2026-10-16" }),
      book({ checkIn: "2026-10-14", checkOut: "2026-10-18" }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json().code ?? loser.json().message?.code).toBe("PROPERTY_NOT_AVAILABLE");

    // And the database agrees: one Booking, one hold, one block.
    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));
    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));

    expect(holds).toHaveLength(1);
    expect(blocks).toHaveLength(1);
  });

  it("survives a wider stampede with a single winner", async () => {
    await setMode("INSTANT_BOOK");

    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        book({ checkIn: "2026-11-10", checkOut: `2026-11-${14 + index}` }),
      ),
    );

    const created = attempts.filter((response) => response.statusCode === 201);
    const rejected = attempts.filter((response) => response.statusCode === 409);

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(5);

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));
    expect(holds).toHaveLength(1);
  });

  it("allows two Stays that only touch", async () => {
    await setMode("INSTANT_BOOK");

    // [12,16) and [16,18) share no night, so both are legitimate.
    const first = await book({ checkIn: "2026-10-12", checkOut: "2026-10-16" });
    const second = await book({ checkIn: "2026-10-16", checkOut: "2026-10-18" });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });
});

describe("existing blocks reject a Booking", () => {
  it("refuses an overlap with a HOST_BLOCK", async () => {
    await setMode("INSTANT_BOOK");
    await addHostBlock("2026-10-13", "2026-10-15");

    const response = await book();
    expect(response.statusCode).toBe(409);
  });

  it("refuses an overlap with an EXTERNAL_CALENDAR block", async () => {
    await setMode("INSTANT_BOOK");

    const [calendar] = await database.db
      .insert(externalCalendars)
      .values({
        propertyId: property.id,
        provider: "AIRBNB",
        name: "Feed",
        importUrlEncrypted: "v1.placeholder",
      })
      .returning();
    await database.db.execute(sql`
      INSERT INTO availability_blocks
        (property_id, source_type, date_range, external_calendar_id, external_event_uid)
      VALUES (${property.id}, 'EXTERNAL_CALENDAR',
              daterange('2026-10-13'::date, '2026-10-15'::date, '[)'),
              ${calendar.id}, 'uid-1')
    `);

    expect((await book()).statusCode).toBe(409);
  });

  it("refuses an overlap with an active BookingHold", async () => {
    await setMode("INSTANT_BOOK");
    expect((await book()).statusCode).toBe(201);
    expect((await book()).statusCode).toBe(409);
  });

  it("ignores an expired hold even before cleanup runs", async () => {
    await setMode("INSTANT_BOOK");
    expect((await book()).statusCode).toBe(201);

    // Backdate the hold without touching its status: exactly the window where
    // the worker has not run yet. Availability must already ignore it.
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.propertyId, property.id));

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));
    expect(holds[0].status).toBe("ACTIVE");

    expect((await book()).statusCode).toBe(201);
  });

  it("keeps an expired hold out of Search", async () => {
    await setMode("INSTANT_BOOK");
    await book();

    const blocked = await app.inject({
      method: "GET",
      url: "/api/search?checkIn=2026-10-13&checkOut=2026-10-15&limit=200",
    });
    expect(blocked.json().items.map((i: { slug: string }) => i.slug)).not.toContain(property.slug);

    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.propertyId, property.id));

    const free = await app.inject({
      method: "GET",
      url: "/api/search?checkIn=2026-10-13&checkOut=2026-10-15&limit=200",
    });
    expect(free.json().items.map((i: { slug: string }) => i.slug)).toContain(property.slug);
  });
});

describe("instant book", () => {
  it("creates a Booking, a hold and a block", async () => {
    await setMode("INSTANT_BOOK");

    const response = await book();
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.status).toBe("PENDING_PAYMENT");
    expect(body.reference).toMatch(/^RZV-[A-Z2-9]{8}$/);
    expect(body.holdExpiresAt).toEqual(expect.any(String));

    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].sourceType).toBe("BOOKING_HOLD");
    expect(blocks[0].bookingHoldId).not.toBeNull();
  });

  it("removes the Property from an overlapping Search", async () => {
    await setMode("INSTANT_BOOK");
    await book();

    const response = await app.inject({
      method: "GET",
      url: "/api/search?checkIn=2026-10-13&checkOut=2026-10-15&limit=200",
    });
    expect(response.json().items.map((i: { slug: string }) => i.slug)).not.toContain(
      property.slug,
    );
  });
});

describe("request to book", () => {
  it("waits for the Host and holds nothing", async () => {
    const response = await book();
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("PENDING_HOST_APPROVAL");
    expect(response.json().holdExpiresAt).toBeNull();

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));
    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));

    // The calendar stays open while the Host decides (§22).
    expect(holds).toHaveLength(0);
    expect(blocks).toHaveLength(0);
  });

  it("creates the hold on accept and moves to PENDING_PAYMENT", async () => {
    await book();
    const [row] = await ownBookings();

    const accepted = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("PENDING_PAYMENT");
    expect(accepted.json().holdExpiresAt).toEqual(expect.any(String));

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.bookingId, row.id));
    expect(holds).toHaveLength(1);
    expect(holds[0].status).toBe("ACTIVE");
  });

  it("does not create a second hold when accept is retried", async () => {
    await book();
    const [row] = await ownBookings();

    const first = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.bookingId, row.id));
    expect(holds).toHaveLength(1);
  });

  it("cancels on reject, and repeating it changes nothing", async () => {
    await book();
    const [row] = await ownBookings();

    const first = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/reject`,
      cookies: host.cookies,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/reject`,
      cookies: host.cookies,
    });

    expect(first.json().status).toBe("CANCELLED");
    expect(first.json().statusReason).toBe("HOST_REJECTED");
    expect(second.json().status).toBe("CANCELLED");
  });

  it("expires the request when the Stay was taken while waiting", async () => {
    await book();
    const [row] = await ownBookings();

    // Somebody else claims the dates before the Host gets round to it.
    await addHostBlock("2026-10-13", "2026-10-15");

    const accepted = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });

    expect(accepted.statusCode).toBe(409);

    const [after] = await database.db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(after.status).toBe("EXPIRED");
    expect(after.statusReason).toBe("AVAILABILITY_LOST");

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.bookingId, row.id));
    expect(holds).toHaveLength(0);
  });
});

describe("hold expiration", () => {
  it("expires the hold and the Booking, and frees the block", async () => {
    await setMode("INSTANT_BOOK");
    await book();

    const [hold] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));

    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));

    const result = await bookingsService.expireBookingHold(hold.id);
    expect(result.expired).toBe(true);

    const [afterHold] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.id, hold.id));
    const [afterBooking] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, hold.bookingId));
    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));

    expect(afterHold.status).toBe("EXPIRED");
    expect(afterBooking.status).toBe("EXPIRED");
    expect(afterBooking.statusReason).toBe("HOLD_EXPIRED");
    expect(blocks).toHaveLength(0);
  });

  it("is idempotent when run twice", async () => {
    await setMode("INSTANT_BOOK");
    await book();
    const [hold] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));

    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));

    expect((await bookingsService.expireBookingHold(hold.id)).expired).toBe(true);
    expect((await bookingsService.expireBookingHold(hold.id)).expired).toBe(false);
  });

  it("does nothing when the job fires early", async () => {
    await setMode("INSTANT_BOOK");
    await book();
    const [hold] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));

    // TTL has not elapsed, so an early job must leave everything alone.
    expect((await bookingsService.expireBookingHold(hold.id)).expired).toBe(false);

    const [after] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.id, hold.id));
    expect(after.status).toBe("ACTIVE");
  });

  it("frees the Property for a new Booking once expired", async () => {
    await setMode("INSTANT_BOOK");
    await book();
    const [hold] = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));

    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));
    await bookingsService.expireBookingHold(hold.id);

    expect((await book()).statusCode).toBe(201);
  });
});

describe("idempotency", () => {
  it("returns the same Booking for the same key and payload", async () => {
    await setMode("INSTANT_BOOK");
    const key = nextKey();

    const first = await book({}, key);
    const second = await book({}, key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().reference).toBe(first.json().reference);

    expect(await ownBookings()).toHaveLength(1);

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));
    expect(holds).toHaveLength(1);
  });

  it("rejects the same key with a different payload", async () => {
    await setMode("INSTANT_BOOK");
    const key = nextKey();

    await book({}, key);
    const response = await book({ adults: 3 }, key);

    expect(response.statusCode).toBe(409);
    expect(response.json().code ?? response.json().message?.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
  });
});

describe("pricing", () => {
  it("prices the Stay on the server and ignores anything the client sends", async () => {
    await setMode("INSTANT_BOOK");

    const response = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "idempotency-key": nextKey() },
      payload: {
        propertyId: property.id,
        checkIn: "2026-10-12",
        checkOut: "2026-10-16",
        adults: 2,
        guest: GUEST,
        // Hostile extras — stripped by the validation pipe, never trusted.
        totalAmountMinor: 1,
        price: { totalAmountMinor: 1 },
      },
    });

    const price = response.json().price;
    // 4 nights x 45000 + 10000 cleaning, from COMPLETE_PROPERTY_PATCH.
    expect(price.accommodationAmountMinor).toBe(180_000);
    expect(price.cleaningFeeAmountMinor).toBe(10_000);
    expect(price.totalAmountMinor).toBe(190_000);
    expect(price.currency).toBe("PLN");
  });

  it("keeps the snapshot after the Property price changes", async () => {
    await setMode("INSTANT_BOOK");
    const response = await book();
    const original = response.json().price.totalAmountMinor;

    await database.db
      .update(properties)
      .set({ baseDailyRateAmountMinor: 99_000 })
      .where(eq(properties.id, property.id));

    // Reading a Booking now needs Guest access; the reference alone is not a
    // credential (milestone 05 §66). The create response sets the cookie.
    const accessCookie = response.cookies.find(
      (cookie) => cookie.name === "rezervio_booking_access",
    );
    const reread = await app.inject({
      method: "GET",
      url: `/api/bookings/${response.json().reference}`,
      cookies: accessCookie ? { rezervio_booking_access: accessCookie.value } : {},
    });

    // What was agreed does not move because the Host raised the rate.
    expect(reread.json().price.totalAmountMinor).toBe(original);

    await database.db
      .update(properties)
      .set({ baseDailyRateAmountMinor: 45_000 })
      .where(eq(properties.id, property.id));
  });
});

describe("validation and ownership", () => {
  it("rejects more guests than the Property accepts", async () => {
    const response = await book({ adults: 4, children: 3 });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an inverted Stay", async () => {
    const response = await book({ checkIn: "2026-10-16", checkOut: "2026-10-12" });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a Property that is not published", async () => {
    const draft = await app.inject({
      method: "POST",
      url: "/api/host/properties",
      cookies: host.cookies,
      payload: { title: "Szkic bez rezerwacji", propertyType: "APARTMENT" },
    });

    const response = await book({ propertyId: draft.json().id });
    expect(response.statusCode).toBe(404);
  });

  it("keeps another Host away from these Bookings", async () => {
    await book();
    const [row] = await ownBookings();

    const attempts = await Promise.all([
      app.inject({ method: "GET", url: `/api/host/bookings/${row.id}`, cookies: stranger.cookies }),
      app.inject({
        method: "POST",
        url: `/api/host/bookings/${row.id}/accept`,
        cookies: stranger.cookies,
      }),
      app.inject({
        method: "POST",
        url: `/api/host/bookings/${row.id}/reject`,
        cookies: stranger.cookies,
      }),
    ]);

    for (const attempt of attempts) expect(attempt.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: "/api/host/bookings",
      cookies: stranger.cookies,
    });
    expect(list.json()).toHaveLength(0);
  });

  it("does not leak Guest contact through the public endpoint", async () => {
    const response = await book();
    const reference = response.json().reference;

    const raw = (await app.inject({ method: "GET", url: `/api/bookings/${reference}` })).body;

    expect(raw).not.toContain(GUEST.email);
    expect(raw).not.toContain(GUEST.phone);
  });

  it("gives the Host the Guest contact they need", async () => {
    await book();
    const [row] = await ownBookings();

    const detail = await app.inject({
      method: "GET",
      url: `/api/host/bookings/${row.id}`,
      cookies: host.cookies,
    });

    expect(detail.json().guestEmail).toBe(GUEST.email);
    expect(detail.json().guestPhone).toBe(GUEST.phone);
  });
});
