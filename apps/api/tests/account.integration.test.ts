import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  availabilityBlocks,
  bookingHolds,
  bookings,
  properties,
  users,
} from "../src/infrastructure/database/schema";
import { GuestAccessService } from "../src/modules/bookings/guest-access.service";
import {
  DATABASE,
  clearFinancials,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerGuest,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";

let app: NestFastifyApplication;
let database: Database;
let guestAccess: GuestAccessService;
let host: TestHost;
let otherHost: TestHost;
let guest: TestHost;
let intruder: TestHost;
let property: { id: string; slug: string };
let otherProperty: { id: string; slug: string };
const created: TestHost[] = [];

let keyCounter = 0;
const nextKey = () => `acct-${Date.now()}-${(keyCounter += 1)}`;

function guestSnapshot(email: string) {
  return { name: "Jan Kowalski", email, phone: "+48600100200" };
}

async function book(
  options: {
    propertyId?: string;
    email?: string;
    cookies?: Record<string, string>;
    checkIn?: string;
    checkOut?: string;
  } = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    ...(options.cookies ? { cookies: options.cookies } : {}),
    payload: {
      propertyId: options.propertyId ?? property.id,
      checkIn: options.checkIn ?? "2029-05-10",
      checkOut: options.checkOut ?? "2029-05-14",
      adults: 2,
      guest: guestSnapshot(options.email ?? "jan@example.com"),
    },
  });
}

async function clearBookings() {
  await database.db.delete(availabilityBlocks).where(sql`booking_hold_id IS NOT NULL`);
  await database.db.delete(bookingHolds);
  await clearFinancials(database);
  await database.db.delete(bookings);
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
}

beforeAll(async () => {
  app = await createTestApp({ emailProvider: new FakeEmailProvider() });
  database = app.get<Database>(DATABASE);
  guestAccess = app.get(GuestAccessService);

  host = await registerHost(app, "acct-host");
  otherHost = await registerHost(app, "acct-other-host");
  guest = await registerGuest(app, "acct-guest");
  intruder = await registerGuest(app, "acct-intruder");
  created.push(host, otherHost, guest, intruder);

  property = await createPublishedProperty(app, host, "Obiekt kontowy");
  otherProperty = await createPublishedProperty(app, otherHost, "Obiekt innego gospodarza");

  // Instant book keeps the tests short: no Host approval step in between.
  await database.db
    .update(properties)
    .set({ bookingMode: "INSTANT_BOOK" })
    .where(sql`id IN (${property.id}::uuid, ${otherProperty.id}::uuid)`);
});

beforeEach(async () => {
  await clearBookings();
});

afterAll(async () => {
  await clearBookings();
  await cleanupHosts(database, created);
  await app.close();
});

describe("booking ownership", () => {
  it("links a Booking made while signed in", async () => {
    const response = await book({ cookies: guest.cookies, email: guest.email });
    expect(response.statusCode).toBe(201);

    const [row] = await database.db.select().from(bookings);
    expect(row.guestUserId).toBe(guest.userId);
  });

  it("leaves an anonymous Booking unattached", async () => {
    const response = await book();
    expect(response.statusCode).toBe(201);

    const [row] = await database.db.select().from(bookings);
    expect(row.guestUserId).toBeNull();
  });

  it("stores the Guest snapshot either way", async () => {
    await book({ cookies: guest.cookies, email: guest.email });

    const [row] = await database.db.select().from(bookings);
    expect(row.guestName).toBe("Jan Kowalski");
    expect(row.guestEmail).toBe(guest.email);
    expect(row.guestPhone).toBe("+48600100200");
  });

  it("does not rewrite a Booking snapshot when the profile changes", async () => {
    await book({ cookies: guest.cookies, email: guest.email });
    const [before] = await database.db.select().from(bookings);

    await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      cookies: guest.cookies,
      payload: { firstName: "Zupełnie", lastName: "Inna", phone: "+48111222333" },
    });

    const [after] = await database.db.select().from(bookings);

    // The snapshot records what was agreed, not the current profile.
    expect(after.guestName).toBe(before.guestName);
    expect(after.guestEmail).toBe(before.guestEmail);
    expect(after.guestPhone).toBe(before.guestPhone);
  });

  it("snapshots the Property city so a trip survives archiving", async () => {
    await book({ cookies: guest.cookies, email: guest.email });

    const [row] = await database.db.select().from(bookings);
    expect(row.propertyCitySnapshot).toBeTruthy();
    expect(row.propertyTitleSnapshot).toBe("Obiekt kontowy");
  });
});

describe("booking own property", () => {
  it("refuses to let a Host book their own Property", async () => {
    const response = await book({ cookies: host.cookies, email: host.email });

    expect(response.statusCode).toBe(409);
    expect(response.json().code ?? response.json().message?.code).toBe(
      "CANNOT_BOOK_OWN_PROPERTY",
    );
  });

  it("lets a Host book somebody else's Property", async () => {
    const response = await book({
      propertyId: otherProperty.id,
      cookies: host.cookies,
      email: host.email,
    });

    expect(response.statusCode).toBe(201);

    const [row] = await database.db.select().from(bookings);
    // The same account is a Guest here and a Host elsewhere.
    expect(row.guestUserId).toBe(host.userId);
  });
});

describe("claiming an anonymous booking", () => {
  async function anonymousBooking(email: string) {
    const response = await book({ email });
    const [row] = await database.db.select().from(bookings);
    return { reference: response.json().reference as string, id: row.id };
  }

  it("attaches the Booking when token, session and email all line up", async () => {
    const { reference, id } = await anonymousBooking(guest.email);
    const token = await guestAccess.issue(id);

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
      cookies: guest.cookies,
    });

    expect(response.statusCode).toBe(200);

    const [row] = await database.db.select().from(bookings);
    expect(row.guestUserId).toBe(guest.userId);
  });

  it("is idempotent", async () => {
    const { reference, id } = await anonymousBooking(guest.email);
    const token = await guestAccess.issue(id);

    const first = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
      cookies: guest.cookies,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
      cookies: guest.cookies,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("refuses a claim backed only by the public reference", async () => {
    const { reference } = await anonymousBooking(guest.email);

    // No token at all: the reference is printed in emails and read out over
    // the phone, so it authorises nothing (milestone 06 §17).
    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim`,
      cookies: guest.cookies,
    });

    expect(response.statusCode).toBe(401);

    const [row] = await database.db.select().from(bookings);
    expect(row.guestUserId).toBeNull();
  });

  it("refuses a claim with no session", async () => {
    const { reference, id } = await anonymousBooking(guest.email);
    const token = await guestAccess.issue(id);

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses when the account email does not match the Booking", async () => {
    const { reference, id } = await anonymousBooking("ktos-inny@example.com");
    const token = await guestAccess.issue(id);

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
      cookies: guest.cookies,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code ?? response.json().message?.code).toBe(
      "BOOKING_EMAIL_MISMATCH",
    );

    const [row] = await database.db.select().from(bookings);
    expect(row.guestUserId).toBeNull();
  });

  it("will not let a second account steal a claimed Booking", async () => {
    const { reference, id } = await anonymousBooking(guest.email);
    const token = await guestAccess.issue(id);

    await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
      cookies: guest.cookies,
    });

    // Even holding a valid token, another account cannot take it over.
    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/claim?token=${token}`,
      cookies: intruder.cookies,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code ?? response.json().message?.code).toBe(
      "BOOKING_ALREADY_CLAIMED",
    );

    const [row] = await database.db.select().from(bookings);
    expect(row.guestUserId).toBe(guest.userId);
  });

  it("refuses a token belonging to a different Booking", async () => {
    const mine = await anonymousBooking(guest.email);
    const theirs = await book({ checkIn: "2029-06-10", checkOut: "2029-06-14" });
    const rows = await database.db.select().from(bookings);
    const other = rows.find((row) => row.id !== mine.id)!;

    const token = await guestAccess.issue(other.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${mine.reference}/claim?token=${token}`,
      cookies: guest.cookies,
    });

    expect(response.statusCode).toBe(401);
    void theirs;
  });
});

describe("my trips", () => {
  it("lists only the signed-in account's Bookings", async () => {
    await book({ cookies: guest.cookies, email: guest.email });
    await book({
      propertyId: otherProperty.id,
      cookies: intruder.cookies,
      email: intruder.email,
    });

    const mine = await app.inject({
      method: "GET",
      url: "/api/account/bookings",
      cookies: guest.cookies,
    });
    const theirs = await app.inject({
      method: "GET",
      url: "/api/account/bookings",
      cookies: intruder.cookies,
    });

    expect(mine.json().items).toHaveLength(1);
    expect(theirs.json().items).toHaveLength(1);
    expect(mine.json().items[0].reference).not.toBe(theirs.json().items[0].reference);
  });

  it("refuses to show another account's trip", async () => {
    const response = await book({ cookies: guest.cookies, email: guest.email });
    const reference = response.json().reference;

    const own = await app.inject({
      method: "GET",
      url: `/api/account/bookings/${reference}`,
      cookies: guest.cookies,
    });
    const foreign = await app.inject({
      method: "GET",
      url: `/api/account/bookings/${reference}`,
      cookies: intruder.cookies,
    });

    expect(own.statusCode).toBe(200);
    // 404 rather than 403 — a 403 would confirm the Booking exists.
    expect(foreign.statusCode).toBe(404);
  });

  it("classifies a hold-awaiting Booking as PENDING", async () => {
    await book({ cookies: guest.cookies, email: guest.email });

    const response = await app.inject({
      method: "GET",
      url: "/api/account/bookings",
      cookies: guest.cookies,
    });

    expect(response.json().items[0].category).toBe("PENDING");
  });

  it("classifies confirmed trips by date", async () => {
    await book({ cookies: guest.cookies, email: guest.email });
    const [row] = await database.db.select().from(bookings);

    await database.db
      .update(bookings)
      .set({ status: "CONFIRMED", checkIn: "2029-05-10", checkOut: "2029-05-14" })
      .where(eq(bookings.id, row.id));

    const upcoming = await app.inject({
      method: "GET",
      url: "/api/account/bookings",
      cookies: guest.cookies,
    });
    expect(upcoming.json().items[0].category).toBe("UPCOMING");

    await database.db
      .update(bookings)
      .set({ checkIn: "2020-01-10", checkOut: "2020-01-14" })
      .where(eq(bookings.id, row.id));

    const past = await app.inject({
      method: "GET",
      url: "/api/account/bookings",
      cookies: guest.cookies,
    });
    expect(past.json().items[0].category).toBe("PAST");
  });

  it("classifies cancelled and expired together", async () => {
    await book({ cookies: guest.cookies, email: guest.email });
    const [row] = await database.db.select().from(bookings);

    for (const status of ["CANCELLED", "EXPIRED"] as const) {
      await database.db.update(bookings).set({ status }).where(eq(bookings.id, row.id));

      const response = await app.inject({
        method: "GET",
        url: "/api/account/bookings?category=CANCELLED",
        cookies: guest.cookies,
      });
      expect(response.json().items[0].category).toBe("CANCELLED");
    }
  });

  it("paginates with a cursor", async () => {
    for (let index = 0; index < 3; index += 1) {
      await book({
        cookies: guest.cookies,
        email: guest.email,
        checkIn: `2029-0${7 + index}-10`,
        checkOut: `2029-0${7 + index}-14`,
      });
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/account/bookings?limit=2",
      cookies: guest.cookies,
    });

    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: "GET",
      url: `/api/account/bookings?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      cookies: guest.cookies,
    });

    expect(second.json().items).toHaveLength(1);
    const seen = [...first.json().items, ...second.json().items].map(
      (item: { reference: string }) => item.reference,
    );
    expect(new Set(seen).size).toBe(3);
  });

  it("keeps a trip readable after the Property is archived", async () => {
    const response = await book({ cookies: guest.cookies, email: guest.email });
    const reference = response.json().reference;

    await database.db
      .update(properties)
      .set({ status: "ARCHIVED" })
      .where(eq(properties.id, property.id));

    const trip = await app.inject({
      method: "GET",
      url: `/api/account/bookings/${reference}`,
      cookies: guest.cookies,
    });

    expect(trip.statusCode).toBe(200);
    expect(trip.json().propertyTitle).toBe("Obiekt kontowy");
    expect(trip.json().propertyCity).toBeTruthy();
    // No public page to link to any more, but the trip itself is intact.
    expect(trip.json().propertySlug).toBeNull();

    await database.db
      .update(properties)
      .set({ status: "PUBLISHED" })
      .where(eq(properties.id, property.id));
  });

  it("needs a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/account/bookings" });
    expect(response.statusCode).toBe(401);
  });
});

describe("profile", () => {
  it("returns the signed-in account's profile", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/account/profile",
      cookies: guest.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: guest.email, isHost: false });
  });

  it("marks a Host account as such", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/account/profile",
      cookies: host.cookies,
    });

    expect(response.json().isHost).toBe(true);
  });

  it("updates the allowed fields", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      cookies: guest.cookies,
      payload: {
        firstName: "Anna",
        lastName: "Nowak",
        phone: "+48500600700",
        preferredLocale: "pl",
      },
    });

    expect(response.json()).toMatchObject({
      firstName: "Anna",
      lastName: "Nowak",
      phone: "+48500600700",
      preferredLocale: "pl",
    });
  });

  it("ignores an attempt to change the email", async () => {
    const before = guest.email;

    await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      cookies: guest.cookies,
      payload: { email: "przejete@example.com", firstName: "Anna" },
    });

    const [row] = await database.db.select().from(users).where(eq(users.id, guest.userId));

    // Email is the login identity; changing it needs a verification flow.
    expect(row.email).toBe(before);
  });

  it("needs a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/account/profile" });
    expect(response.statusCode).toBe(401);
  });
});
