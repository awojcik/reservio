import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  availabilityBlocks,
  bookingEvents,
  bookingGuestAccessTokens,
  bookingHolds,
  bookings,
  notificationDeliveries,
  outboxEvents,
  properties,
  type NotificationType,
} from "../src/infrastructure/database/schema";
import { BookingsService } from "../src/modules/bookings/bookings.service";
import { BookingLifecycleWorker } from "../src/modules/bookings/booking-lifecycle.worker";
import { NotificationsService } from "../src/modules/notifications/application/notifications.service";
import { GuestAccessService } from "../src/modules/bookings/guest-access.service";
import {
  DATABASE,
  cleanupHosts,
  createPublishedProperty,
  createTestApp,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";

let app: NestFastifyApplication;
let database: Database;
let email: FakeEmailProvider;
let bookingsService: BookingsService;
let lifecycle: BookingLifecycleWorker;
let guestAccess: GuestAccessService;
let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

const GUEST = { name: "Jan Kowalski", email: "jan@example.com", phone: "+48600100200" };

let keyCounter = 0;
const nextKey = () => `ops-${Date.now()}-${(keyCounter += 1)}`;

async function setMode(mode: "REQUEST_TO_BOOK" | "INSTANT_BOOK") {
  await database.db
    .update(properties)
    .set({ bookingMode: mode })
    .where(eq(properties.id, property.id));
}

async function book(overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId: property.id,
      checkIn: "2027-10-12",
      checkOut: "2027-10-16",
      adults: 2,
      guest: GUEST,
      ...overrides,
    },
  });
}

/** Extracts the guest cookie the create response sets. */
function guestCookie(response: { cookies: { name: string; value: string }[] }) {
  const cookie = response.cookies.find((entry) => entry.name === "rezervio_booking_access");
  if (!cookie) throw new Error("Brak cookie dostępu gościa");
  return { rezervio_booking_access: cookie.value };
}

async function ownBookings() {
  return database.db.select().from(bookings).where(eq(bookings.propertyId, property.id));
}

async function reset() {
  await database.db
    .delete(availabilityBlocks)
    .where(eq(availabilityBlocks.propertyId, property.id));
  await database.db.delete(bookingHolds).where(eq(bookingHolds.propertyId, property.id));
  await database.db.delete(bookings).where(eq(bookings.propertyId, property.id));
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
  email.reset();
}

beforeAll(async () => {
  email = new FakeEmailProvider();
  app = await createTestApp({ emailProvider: email });
  database = app.get<Database>(DATABASE);
  bookingsService = app.get(BookingsService);
  lifecycle = app.get(BookingLifecycleWorker);
  guestAccess = app.get(GuestAccessService);

  host = await registerHost(app, "ops-owner");
  stranger = await registerHost(app, "ops-stranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "Obiekt operacyjny");
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

describe("guest access", () => {
  it("refuses to serve a Booking on the reference alone", async () => {
    const created = await book();
    const reference = created.json().reference;

    // The reference is printed in emails and read out over the phone; it
    // identifies a Booking but authorises nothing.
    const response = await app.inject({ method: "GET", url: `/api/bookings/${reference}` });
    expect(response.statusCode).toBe(401);
  });

  it("serves the Booking with the cookie set at creation", async () => {
    const created = await book();
    const reference = created.json().reference;

    const response = await app.inject({
      method: "GET",
      url: `/api/bookings/${reference}`,
      cookies: guestCookie(created),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reference).toBe(reference);
  });

  it("exchanges a token from an email link for a cookie", async () => {
    const created = await book();
    const reference = created.json().reference;
    const [row] = await ownBookings();

    const token = await guestAccess.issue(row.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/access`,
      payload: { token },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.cookies.some((cookie) => cookie.name === "rezervio_booking_access"),
    ).toBe(true);
  });

  it("rejects an invalid or revoked token", async () => {
    const created = await book();
    const reference = created.json().reference;
    const [row] = await ownBookings();

    const token = await guestAccess.issue(row.id);
    await guestAccess.revokeAll(row.id);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/access`,
      payload: { token: "zupelnie-zmyslony-token" },
    });
    const revoked = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/access`,
      payload: { token },
    });

    expect(invalid.statusCode).toBe(401);
    expect(revoked.statusCode).toBe(401);
  });

  it("will not open somebody else's Booking with a valid token", async () => {
    const mine = await book();
    const other = await book({ checkIn: "2027-11-01", checkOut: "2027-11-04" });
    const rows = await ownBookings();

    const token = await guestAccess.issue(rows[0].id);
    const otherReference =
      other.json().reference === mine.json().reference
        ? mine.json().reference
        : other.json().reference;

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${otherReference}/access`,
      payload: { token },
    });

    // The token is bound to one Booking; pairing it with another reference
    // must not authenticate anything.
    if (otherReference !== mine.json().reference) {
      expect(response.statusCode).toBe(401);
    }
  });

  it("stores only a hash of the token", async () => {
    const created = await book();
    const [row] = await ownBookings();
    const token = await guestAccess.issue(row.id);

    const stored = await database.db
      .select()
      .from(bookingGuestAccessTokens)
      .where(eq(bookingGuestAccessTokens.bookingId, row.id));

    expect(stored.length).toBeGreaterThan(0);
    for (const entry of stored) {
      expect(entry.tokenHash).not.toBe(token);
      expect(entry.tokenHash).toHaveLength(64);
    }
    void created;
  });
});

describe("request expiry", () => {
  it("stores a deadline on a request and none on an instant booking", async () => {
    const request = await book();
    expect(request.json().hostResponseDeadlineAt).toEqual(expect.any(String));

    await setMode("INSTANT_BOOK");
    const instant = await book({ checkIn: "2027-12-01", checkOut: "2027-12-04" });
    expect(instant.json().hostResponseDeadlineAt).toBeNull();
  });

  it("accepts a request before its deadline", async () => {
    await book();
    const [row] = await ownBookings();

    const response = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });
    expect(response.statusCode).toBe(200);
  });

  it("refuses to accept after the deadline, even before the worker runs", async () => {
    await book();
    const [row] = await ownBookings();

    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() - 1000) })
      .where(eq(bookings.id, row.id));

    const response = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code ?? response.json().message?.code).toBe(
      "BOOKING_REQUEST_EXPIRED",
    );

    const [after] = await ownBookings();
    expect(after.status).toBe("EXPIRED");
    expect(after.statusReason).toBe("HOST_RESPONSE_TIMEOUT");
  });

  it("expires a lapsed request and is idempotent", async () => {
    await book();
    const [row] = await ownBookings();
    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() - 1000) })
      .where(eq(bookings.id, row.id));

    expect((await bookingsService.expireBookingRequest(row.id)).expired).toBe(true);
    expect((await bookingsService.expireBookingRequest(row.id)).expired).toBe(false);

    const [after] = await ownBookings();
    expect(after.status).toBe("EXPIRED");
  });

  it("does nothing when the job fires before the deadline", async () => {
    await book();
    const [row] = await ownBookings();

    expect((await bookingsService.expireBookingRequest(row.id)).expired).toBe(false);
    expect((await ownBookings())[0].status).toBe("PENDING_HOST_APPROVAL");
  });

  it("queues the Guest notification exactly once", async () => {
    await book();
    const [row] = await ownBookings();
    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() - 1000) })
      .where(eq(bookings.id, row.id));

    await bookingsService.expireBookingRequest(row.id);
    await bookingsService.expireBookingRequest(row.id);

    const queued = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, row.id));

    expect(
      queued.filter((entry) =>
        entry.payloadJson.includes("BOOKING_REQUEST_EXPIRED"),
      ),
    ).toHaveLength(1);
  });

  it("sweeps requests whose delayed job was lost", async () => {
    await book();
    const [row] = await ownBookings();
    await database.db
      .update(bookings)
      .set({ hostResponseDeadlineAt: new Date(Date.now() - 1000) })
      .where(eq(bookings.id, row.id));

    const { expired } = await lifecycle.sweep();
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await ownBookings())[0].status).toBe("EXPIRED");
  });
});

describe("host reminder", () => {
  it("nudges a request that is still waiting", async () => {
    await book();
    const [row] = await ownBookings();

    expect((await lifecycle.sendReminder(row.id)).sent).toBe(true);
  });

  it("stays silent once the Host has answered", async () => {
    await book();
    const [row] = await ownBookings();

    await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });

    expect((await lifecycle.sendReminder(row.id)).sent).toBe(false);
  });

  it("stays silent after a rejection", async () => {
    await book();
    const [row] = await ownBookings();

    await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/reject`,
      cookies: host.cookies,
    });

    expect((await lifecycle.sendReminder(row.id)).sent).toBe(false);
  });

  it("sends one reminder even when delivered twice", async () => {
    await book();
    const [row] = await ownBookings();

    await lifecycle.sendReminder(row.id);
    await lifecycle.sendReminder(row.id);

    // The reminder is enqueued directly rather than through the outbox: it
    // accompanies no state change, so there is no transaction to be atomic
    // with. Dedup still comes from notification_deliveries.
    await deliver(row.id, "BOOKING_REQUEST_REMINDER");
    await deliver(row.id, "BOOKING_REQUEST_REMINDER");

    expect(email.countOf("Przypomnienie")).toBe(1);
  });
});

/** Sends one notification the way the worker would, bypassing Redis. */
async function deliver(bookingId: string, type: NotificationType): Promise<void> {
  await app.get(NotificationsService).deliver(bookingId, type);
}

/** Delivers everything the outbox holds for a Booking. */
async function deliverAll(bookingId: string): Promise<void> {
  const events = await database.db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.aggregateId, bookingId));

  for (const event of events) {
    const payload = JSON.parse(event.payloadJson) as { notificationType?: string };
    if (payload.notificationType) {
      await deliver(bookingId, payload.notificationType as NotificationType);
    }
  }
}

describe("guest cancellation", () => {
  it("cancels a pending request", async () => {
    const created = await book();
    const reference = created.json().reference;

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/cancel`,
      cookies: guestCookie(created),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("CANCELLED");
    expect(response.json().statusReason).toBe("GUEST_CANCELLED");
  });

  it("releases the hold and frees the dates", async () => {
    await setMode("INSTANT_BOOK");
    const created = await book();
    const reference = created.json().reference;

    const blocked = await app.inject({
      method: "GET",
      url: "/api/search?checkIn=2027-10-13&checkOut=2027-10-15&limit=200",
    });
    expect(blocked.json().items.map((i: { slug: string }) => i.slug)).not.toContain(
      property.slug,
    );

    await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/cancel`,
      cookies: guestCookie(created),
    });

    const holds = await database.db
      .select()
      .from(bookingHolds)
      .where(eq(bookingHolds.propertyId, property.id));
    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));

    expect(holds[0].status).toBe("RELEASED");
    expect(blocks).toHaveLength(0);

    const free = await app.inject({
      method: "GET",
      url: "/api/search?checkIn=2027-10-13&checkOut=2027-10-15&limit=200",
    });
    expect(free.json().items.map((i: { slug: string }) => i.slug)).toContain(property.slug);
  });

  it("needs guest access", async () => {
    const created = await book();
    const reference = created.json().reference;

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/cancel`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("is safe to retry", async () => {
    const created = await book();
    const reference = created.json().reference;
    const cookies = guestCookie(created);

    const first = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/cancel`,
      cookies,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/bookings/${reference}/cancel`,
      cookies,
    });

    expect(first.json().status).toBe("CANCELLED");
    expect(second.json().status).toBe("CANCELLED");

    const [row] = await ownBookings();
    const cancelEvents = await database.db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, row.id));

    // One command applied once, so one event — not one per retry.
    expect(cancelEvents.filter((e) => e.type === "GUEST_CANCELLED")).toHaveLength(1);
  });
});

describe("host cancellation", () => {
  it("cancels and releases the hold", async () => {
    await setMode("INSTANT_BOOK");
    await book();
    const [row] = await ownBookings();

    const response = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/cancel`,
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().statusReason).toBe("HOST_CANCELLED");

    const blocks = await database.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.propertyId, property.id));
    expect(blocks).toHaveLength(0);
  });

  it("keeps another Host out", async () => {
    await book();
    const [row] = await ownBookings();

    const response = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/cancel`,
      cookies: stranger.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it("refuses to cancel something already finished", async () => {
    await book();
    const [row] = await ownBookings();

    await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/reject`,
      cookies: host.cookies,
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/cancel`,
      cookies: host.cookies,
    });

    // Already CANCELLED — retry-safe, not an error.
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("CANCELLED");
  });
});

describe("notifications", () => {
  it("sends one email per logical event, however many times it is retried", async () => {
    await book();
    const [row] = await ownBookings();

    await deliverAll(row.id);
    await deliverAll(row.id);
    await deliverAll(row.id);

    expect(email.countOf("Nowa prośba o rezerwację")).toBe(1);

    const deliveries = await database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, row.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("SENT");
  });

  it("retries a temporary failure and eventually delivers", async () => {
    await book();
    const [row] = await ownBookings();

    email.failTemporarily(2);

    await expect(deliverAll(row.id)).rejects.toBeTruthy();
    await expect(deliverAll(row.id)).rejects.toBeTruthy();
    email.succeed();
    await deliverAll(row.id);

    expect(email.countOf("Nowa prośba o rezerwację")).toBe(1);
  });

  it("marks a permanent failure and stops", async () => {
    await book();
    const [row] = await ownBookings();

    email.failPermanently();
    await deliverAll(row.id);

    const [delivery] = await database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, row.id));

    expect(delivery.status).toBe("FAILED");
    expect(delivery.lastErrorCode).toBe("SMTP_550");
    expect(email.sent).toHaveLength(0);
  });

  it("leaves the Booking untouched when email fails", async () => {
    await book();
    const [row] = await ownBookings();

    email.failPermanently();
    await deliverAll(row.id);

    const [after] = await ownBookings();
    expect(after.status).toBe("PENDING_HOST_APPROVAL");
  });

  it("does not put Guest details into the queue payload", async () => {
    await book();
    const [row] = await ownBookings();

    const events = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, row.id));

    for (const event of events) {
      expect(event.payloadJson).not.toContain(GUEST.email);
      expect(event.payloadJson).not.toContain(GUEST.phone);
      expect(event.payloadJson).not.toContain(GUEST.name);
    }
  });
});

describe("timeline", () => {
  it("records one event per transition", async () => {
    await book();
    const [row] = await ownBookings();

    await app.inject({
      method: "POST",
      url: `/api/host/bookings/${row.id}/accept`,
      cookies: host.cookies,
    });

    const events = await database.db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, row.id))
      .orderBy(bookingEvents.createdAt);

    expect(events.map((event) => event.type)).toEqual([
      "BOOKING_CREATED",
      "HOST_ACCEPTED",
      "HOLD_CREATED",
    ]);
    expect(events.map((event) => event.actorType)).toEqual(["GUEST", "HOST", "SYSTEM"]);
  });

  it("is exposed to both sides", async () => {
    const created = await book();
    const [row] = await ownBookings();

    const guestView = await app.inject({
      method: "GET",
      url: `/api/bookings/${created.json().reference}`,
      cookies: guestCookie(created),
    });
    const hostView = await app.inject({
      method: "GET",
      url: `/api/host/bookings/${row.id}`,
      cookies: host.cookies,
    });

    expect(guestView.json().timeline[0].type).toBe("BOOKING_CREATED");
    expect(hostView.json().timeline[0].type).toBe("BOOKING_CREATED");
  });

  it("tells the Guest what they may do", async () => {
    const created = await book();
    expect(created.json().allowedActions.canCancel).toBe(true);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/bookings/${created.json().reference}/cancel`,
      cookies: guestCookie(created),
    });
    expect(cancelled.json().allowedActions.canCancel).toBe(false);
  });
});
