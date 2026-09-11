import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  bookingEvents,
  bookingHolds,
  bookings,
  properties,
  propertySensitiveAccess,
  propertyStayInformation,
} from "../src/infrastructure/database/schema";
import { StayLifecycleWorker } from "../src/modules/stay/stay-lifecycle.worker";
import { StayService } from "../src/modules/stay/stay.service";
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
let emails: FakeEmailProvider;
let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `stay-${Date.now()}-${(counter += 1)}`;

const STAY_INFO = {
  checkInTime: "15:00",
  checkOutTime: "11:00",
  arrivalInstructions: "Wejście od podwórza, drzwi po prawej.",
  parkingInstructions: "Miejsce numer 12 w garażu podziemnym.",
  wifiName: "Baltic-Guest",
  wifiPassword: "morze2026",
  houseRules: "Cisza nocna od 22:00.",
  departureInstructions: "Klucz zostaw w keyboxie i zatrzaśnij drzwi.",
  emergencyContact: "+48 600 100 200",
  instructionsSendOffsetHours: 24,
};

const ACCESS = {
  accessInstructions: "Keybox przy skrzynkach pocztowych.",
  accessCode: "918273",
  keyboxLocation: "Na lewo od drzwi, pod domofonem.",
  revealOffsetHours: 6,
};

async function saveStayInfo(overrides: Record<string, unknown> = {}, who = host, target = property.id) {
  return app.inject({
    method: "PUT",
    url: `/api/host/properties/${target}/stay-information`,
    cookies: who.cookies,
    payload: { ...STAY_INFO, ...overrides },
  });
}

async function saveAccess(overrides: Record<string, unknown> = {}, who = host, target = property.id) {
  return app.inject({
    method: "PUT",
    url: `/api/host/properties/${target}/sensitive-access`,
    cookies: who.cookies,
    payload: { ...ACCESS, ...overrides },
  });
}

/** A CONFIRMED Booking with its Guest access token, the way payment leaves it. */
async function confirmedBooking(
  checkIn = "2029-09-12",
  checkOut = "2029-09-18",
  target = property.id,
): Promise<{ id: string; reference: string; token: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId: target,
      checkIn,
      checkOut,
      adults: 2,
      guest: { name: "Anna Nowak", email: "anna@example.com" },
    },
  });

  const reference = response.json().reference as string;
  const token = response.cookies.find((c) => c.name === "rezervio_booking_access")!.value;

  const [row] = await database.db
    .select()
    .from(bookings)
    .where(eq(bookings.publicReference, reference));

  await database.db
    .update(bookings)
    .set({ status: "CONFIRMED", confirmedAt: new Date() })
    .where(eq(bookings.id, row.id));

  return { id: row.id, reference, token };
}

async function stayDetails(booking: { reference: string; token: string }) {
  return app.inject({
    method: "GET",
    url: `/api/bookings/${booking.reference}/stay`,
    cookies: { rezervio_booking_access: booking.token },
  });
}

async function reset() {
  await database.db.delete(bookingEvents);
  await database.db.delete(bookingHolds);
  await database.db.execute(sql`DELETE FROM booking_messages`);
  await database.db.execute(sql`DELETE FROM booking_conversations`);
  await clearFinancials(database);
  await database.db.delete(bookings);
  await database.db.delete(propertyStayInformation);
  await database.db.delete(propertySensitiveAccess);
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
  emails.reset();
}

beforeAll(async () => {
  emails = new FakeEmailProvider();
  app = await createTestApp({ emailProvider: emails });
  database = app.get<Database>(DATABASE);

  host = await registerHost(app, "stay-owner");
  stranger = await registerHost(app, "stay-stranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "Baltic Loft");

  await database.db
    .update(properties)
    .set({ bookingMode: "INSTANT_BOOK", timeZone: "Europe/Warsaw" })
    .where(eq(properties.id, property.id));
});

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await reset();
  await cleanupHosts(database, created);
  await app.close();
});

describe("stay information", () => {
  it("is configured once per Property", async () => {
    const saved = await saveStayInfo();

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      checkInTime: "15:00",
      checkOutTime: "11:00",
      instructionsSendOffsetHours: 24,
      configured: true,
      timeZone: "Europe/Warsaw",
    });

    const read = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/stay-information`,
      cookies: host.cookies,
    });
    expect(read.json().wifiName).toBe("Baltic-Guest");
  });

  it("reports sensible defaults before anything is saved", async () => {
    const read = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/stay-information`,
      cookies: host.cookies,
    });

    expect(read.json()).toMatchObject({
      configured: false,
      checkInTime: "15:00",
      instructionsSendOffsetHours: 24,
    });
  });

  it("updates rather than duplicating", async () => {
    await saveStayInfo();
    await saveStayInfo({ checkInTime: "16:00", instructionsSendOffsetHours: 48 });

    const rows = await database.db
      .select()
      .from(propertyStayInformation)
      .where(eq(propertyStayInformation.propertyId, property.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].checkInTime).toBe("16:00");
    expect(rows[0].instructionsSendOffsetHours).toBe(48);
  });

  it("rejects a time that is not a wall clock", async () => {
    expect((await saveStayInfo({ checkInTime: "25:00" })).statusCode).toBe(400);
    expect((await saveStayInfo({ checkOutTime: "11" })).statusCode).toBe(400);
  });

  it("accepts only the offered offsets", async () => {
    expect((await saveStayInfo({ instructionsSendOffsetHours: 5 })).statusCode).toBe(400);
    expect((await saveStayInfo({ instructionsSendOffsetHours: 72 })).statusCode).toBe(200);
  });

  it("keeps one Host out of another Host's Property", async () => {
    expect((await saveStayInfo({}, stranger)).statusCode).toBe(404);

    const read = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/stay-information`,
      cookies: stranger.cookies,
    });
    expect(read.statusCode).toBe(404);
  });

  it("needs a Host profile at all", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/stay-information`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("guest stay details", () => {
  it("shows the whole stay to the Guest of that Booking", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking();

    const response = await stayDetails(booking);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      reference: booking.reference,
      checkInTime: "15:00",
      checkOutTime: "11:00",
      wifiName: "Baltic-Guest",
      houseRules: "Cisza nocna od 22:00.",
      emergencyContact: "+48 600 100 200",
      phase: "BEFORE_STAY",
    });
  });

  it("resolves check-in against the Property time zone", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking();

    // 15:00 in Warsaw in September is 13:00 UTC.
    expect((await stayDetails(booking)).json().checkInAt).toBe("2029-09-12T13:00:00.000Z");
    expect((await stayDetails(booking)).json().checkOutAt).toBe("2029-09-18T09:00:00.000Z");
  });

  it("computes the phase instead of asking the Guest", async () => {
    await saveStayInfo();
    const past = await confirmedBooking("2020-01-10", "2020-01-14");
    // Deliberately not overlapping the Stay above — the same Property cannot
    // hold two overlapping Bookings.
    const now = await confirmedBooking("2021-01-01", "2099-01-01");

    expect((await stayDetails(past)).json().phase).toBe("AFTER_STAY");
    expect((await stayDetails(now)).json().phase).toBe("IN_STAY");
  });

  it("refuses a caller with no access to this Booking", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking();

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/bookings/${booking.reference}/stay`,
    });
    expect(anonymous.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: "GET",
      url: `/api/bookings/${booking.reference}/stay`,
      cookies: { rezervio_booking_access: "nie-ten-token" },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it("keeps stay information off the public Property page", async () => {
    await saveStayInfo();

    const publicView = await app.inject({
      method: "GET",
      url: `/api/properties/${property.slug}`,
    });

    const body = JSON.stringify(publicView.json());
    for (const secret of ["morze2026", "Baltic-Guest", "+48 600 100 200", "Wejście od podwórza"]) {
      expect(body).not.toContain(secret);
    }
  });
});

describe("sensitive access", () => {
  it("is stored as ciphertext", async () => {
    await saveAccess();

    const [row] = await database.db
      .select()
      .from(propertySensitiveAccess)
      .where(eq(propertySensitiveAccess.propertyId, property.id));

    expect(row.accessCodeEncrypted).not.toBeNull();
    expect(row.accessCodeEncrypted).not.toContain("918273");
    expect(row.accessCodeEncrypted!.startsWith("v1.")).toBe(true);
    expect(row.keyboxLocationEncrypted).not.toContain("domofonem");
  });

  it("reads back for the Host who owns the Property", async () => {
    await saveAccess();

    const read = await app.inject({
      method: "GET",
      url: `/api/host/properties/${property.id}/sensitive-access`,
      cookies: host.cookies,
    });

    expect(read.json()).toMatchObject({ accessCode: "918273", revealOffsetHours: 6 });
  });

  it("withholds every part of the secret before the reveal time", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    const access = (await stayDetails(booking)).json().access;

    expect(access).toMatchObject({
      configured: true,
      available: false,
      accessCode: null,
      accessInstructions: null,
      keyboxLocation: null,
    });
    // 6 hours before 15:00 Warsaw = 09:00 local = 07:00 UTC.
    expect(access.revealAt).toBe("2029-09-12T07:00:00.000Z");

    const body = JSON.stringify((await stayDetails(booking)).json());
    expect(body).not.toContain("918273");
    expect(body).not.toContain("domofonem");
  });

  it("hands the secret over once the reveal time has passed", async () => {
    await saveStayInfo();
    await saveAccess();
    // Check-in already happened, so the reveal instant is in the past.
    const booking = await confirmedBooking("2020-05-10", "2020-05-14");

    const access = (await stayDetails(booking)).json().access;

    expect(access).toMatchObject({
      available: true,
      accessCode: "918273",
      keyboxLocation: "Na lewo od drzwi, pod domofonem.",
      revealAt: null,
      revealedManually: false,
    });
  });

  it("computes the reveal instant in the Property time zone", async () => {
    await saveStayInfo();
    await saveAccess({ revealOffsetHours: 24 });

    await database.db
      .update(properties)
      .set({ timeZone: "Pacific/Auckland" })
      .where(eq(properties.id, property.id));

    const booking = await confirmedBooking();
    // 15:00 in Auckland on 12 Sep 2029 is 03:00 UTC; 24h earlier is the 11th.
    expect((await stayDetails(booking)).json().access.revealAt).toBe(
      "2029-09-11T03:00:00.000Z",
    );

    await database.db
      .update(properties)
      .set({ timeZone: "Europe/Warsaw" })
      .where(eq(properties.id, property.id));
  });

  it("never opens the door for a cancelled Booking", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking("2020-05-10", "2020-05-14");

    await database.db
      .update(bookings)
      .set({ status: "CANCELLED" })
      .where(eq(bookings.id, booking.id));

    expect((await stayDetails(booking)).json().access.available).toBe(false);
  });

  it("says nothing is configured when the Host stored nothing", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking("2020-05-10", "2020-05-14");

    expect((await stayDetails(booking)).json().access).toMatchObject({
      configured: false,
      available: false,
      revealAt: null,
    });
  });
});

describe("manual reveal by the Host", () => {
  async function reveal(bookingId: string, who = host) {
    return app.inject({
      method: "POST",
      url: `/api/host/bookings/${bookingId}/sensitive-access/reveal`,
      cookies: who.cookies,
    });
  }

  it("lets the Guest see the code straight away", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    expect((await stayDetails(booking)).json().access.available).toBe(false);

    const response = await reveal(booking.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: true, configured: true });

    const access = (await stayDetails(booking)).json().access;
    expect(access).toMatchObject({
      available: true,
      accessCode: "918273",
      revealedManually: true,
    });
  });

  it("leaves the Property default alone", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    await reveal(booking.id);

    const [row] = await database.db
      .select()
      .from(propertySensitiveAccess)
      .where(eq(propertySensitiveAccess.propertyId, property.id));
    expect(row.revealOffsetHours).toBe(6);

    // And the next Guest still waits for the normal time.
    const other = await confirmedBooking("2029-11-10", "2029-11-14");
    expect((await stayDetails(other)).json().access.available).toBe(false);
  });

  it("is idempotent and mails once", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    const first = await reveal(booking.id);
    const second = await reveal(booking.id);

    expect(second.statusCode).toBe(200);
    expect(second.json().manualRevealAt).toBe(first.json().manualRevealAt);

    const events = await database.db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, booking.id));
    expect(events.filter((e) => e.type === "SENSITIVE_ACCESS_REVEALED")).toHaveLength(1);
  });

  it("writes an audit event", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    await reveal(booking.id);

    const [event] = await database.db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.type, "SENSITIVE_ACCESS_REVEALED"));

    expect(event.bookingId).toBe(booking.id);
    expect(event.actorType).toBe("SYSTEM");
    expect(event.metadataJson).toContain("HOST");
  });

  it("refuses a Booking that is not confirmed", async () => {
    await saveStayInfo();
    await saveAccess();

    const pending = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "idempotency-key": nextKey() },
      payload: {
        propertyId: property.id,
        checkIn: "2029-10-12",
        checkOut: "2029-10-18",
        adults: 2,
        guest: { name: "Ewa Lis", email: "ewa@example.com" },
      },
    });

    const [row] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.publicReference, pending.json().reference));

    const response = await reveal(row.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().message.code ?? response.json().code).toBe("BOOKING_NOT_CONFIRMED");
  });

  it("refuses another Host's Booking", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    expect((await reveal(booking.id, stranger)).statusCode).toBe(404);
    // And the Guest still cannot see anything.
    expect((await stayDetails(booking)).json().access.available).toBe(false);
  });
});

describe("stay scheduling", () => {
  it("plans every stay job from the Property configuration", async () => {
    await saveStayInfo();
    await saveAccess();
    const booking = await confirmedBooking();

    const schedule = await app.get(StayService).scheduleFor(booking.id);

    expect(schedule).not.toBeNull();
    // check-in 2029-09-12 15:00 Warsaw = 13:00 UTC
    expect(schedule!.window.checkInAt.toISOString()).toBe("2029-09-12T13:00:00.000Z");
    // instructions 24h earlier
    expect(schedule!.instructionsAt.toISOString()).toBe("2029-09-11T13:00:00.000Z");
    // access 6h earlier
    expect(schedule!.scheduledRevealAt.toISOString()).toBe("2029-09-12T07:00:00.000Z");
    // checkout reminder 24h before 11:00 Warsaw
    expect(schedule!.checkoutReminderAt.toISOString()).toBe("2029-09-17T09:00:00.000Z");
  });

  it("follows the Host's chosen offset", async () => {
    await saveStayInfo({ instructionsSendOffsetHours: 72 });
    const booking = await confirmedBooking();

    const schedule = await app.get(StayService).scheduleFor(booking.id);
    expect(schedule!.instructionsAt.toISOString()).toBe("2029-09-09T13:00:00.000Z");
  });

  it("moves the schedule when the Host changes the check-in time", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking();

    await saveStayInfo({ checkInTime: "18:00" });

    const schedule = await app.get(StayService).scheduleFor(booking.id);
    expect(schedule!.window.checkInAt.toISOString()).toBe("2029-09-12T16:00:00.000Z");
    expect(schedule!.instructionsAt.toISOString()).toBe("2029-09-11T16:00:00.000Z");
  });

  it("sends instructions only for a Booking that is still confirmed", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking();
    const worker = app.get(StayLifecycleWorker);

    expect(await worker.sendInstructions(booking.id)).toEqual({ sent: true });

    await database.db
      .update(bookings)
      .set({ status: "CANCELLED" })
      .where(eq(bookings.id, booking.id));

    expect(await worker.sendInstructions(booking.id)).toEqual({ sent: false });
  });

  it("does not announce access the Host never configured", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking();

    expect(await app.get(StayLifecycleWorker).announceAccess(booking.id)).toEqual({
      sent: false,
    });
  });
});

describe("automatic completion", () => {
  it("closes a Booking once the Stay is over", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking("2020-05-10", "2020-05-14");

    expect(await app.get(StayLifecycleWorker).completeBooking(booking.id)).toEqual({
      completed: true,
    });

    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row.status).toBe("COMPLETED");
  });

  it("leaves a Stay that has not finished alone", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking("2021-01-01", "2099-01-01");

    expect(await app.get(StayLifecycleWorker).completeBooking(booking.id)).toEqual({
      completed: false,
    });

    const [row] = await database.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row.status).toBe("CONFIRMED");
  });

  it("respects the Property time zone at the boundary", async () => {
    await saveStayInfo();
    await database.db
      .update(properties)
      .set({ timeZone: "Pacific/Auckland" })
      .where(eq(properties.id, property.id));

    // 11:00 in Auckland is 23:00 UTC the previous day; a checkout dated today
    // in UTC terms has therefore already passed there.
    const today = new Date().toISOString().slice(0, 10);
    const booking = await confirmedBooking("2020-01-01", today);

    const schedule = await app.get(StayService).scheduleFor(booking.id);
    expect(schedule!.window.checkOutAt.getTime()).toBeLessThan(Date.now());

    await database.db
      .update(properties)
      .set({ timeZone: "Europe/Warsaw" })
      .where(eq(properties.id, property.id));
  });

  it("is idempotent", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking("2020-05-10", "2020-05-14");
    const worker = app.get(StayLifecycleWorker);

    await worker.completeBooking(booking.id);
    expect(await worker.completeBooking(booking.id)).toEqual({ completed: false });

    const events = await database.db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.type, "BOOKING_COMPLETED"));
    expect(events).toHaveLength(1);
  });

  it("never completes a Booking that was never confirmed", async () => {
    await saveStayInfo();
    const booking = await confirmedBooking("2020-05-10", "2020-05-14");
    await database.db
      .update(bookings)
      .set({ status: "CANCELLED" })
      .where(eq(bookings.id, booking.id));

    expect(await app.get(StayLifecycleWorker).completeBooking(booking.id)).toEqual({
      completed: false,
    });
  });
});
