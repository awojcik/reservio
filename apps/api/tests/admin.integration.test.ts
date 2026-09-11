import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Queue } from "bullmq";

import type { Database } from "../src/infrastructure/database/connection";
import {
  adminActions,
  bookingSettlements,
  bookings,
  hostPaymentAccounts,
  notificationDeliveries,
  payments,
  refunds,
} from "../src/infrastructure/database/schema";
import { NOTIFICATIONS_QUEUE, SYNC_QUEUE } from "../src/infrastructure/queue/queue.module";
import { NotificationsService } from "../src/modules/notifications/application/notifications.service";
import { SettlementsService } from "../src/modules/settlements/settlements.service";
import {
  DATABASE,
  cleanupHosts,
  clearFinancials,
  createPublishedProperty,
  createTestApp,
  grantRole,
  registerGuest,
  registerHost,
  type TestHost,
} from "./helpers/host-fixture";
import { FakeEmailProvider } from "./helpers/fake-email-provider";
import { FakePaymentProvider, signedEvent } from "./helpers/fake-payment-provider";

let app: NestFastifyApplication;
let database: Database;
let provider: FakePaymentProvider;
let settlements: SettlementsService;
let notifications: NotificationsService;
let notificationQueue: Queue;
let syncQueue: Queue;

let admin: TestHost;
let support: TestHost;
let host: TestHost;
let guest: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `admin-${Date.now()}-${(counter += 1)}`;

type Paid = { bookingId: string; reference: string; intentId: string; totalMinor: number };

/**
 * Sends one notification for real.
 *
 * The background worker is off in the suite, so the delivery row a real
 * confirmation would leave behind has to be produced by calling the same
 * service the worker calls — not by inserting a row the pipeline never made.
 */
async function deliverConfirmation(bookingId: string): Promise<string> {
  await notifications.deliver(bookingId, "BOOKING_CONFIRMED");

  const [delivery] = await database.db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.bookingId, bookingId))
    .limit(1);

  return delivery.id;
}

/** A Booking taken all the way through payment, the way production does it. */
async function paidBooking(checkIn = "2029-11-12", checkOut = "2029-11-18"): Promise<Paid> {
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
  if (started.statusCode !== 200) throw new Error(`payment ${started.statusCode} ${started.body}`);

  const intentId = provider.intentFor(started.json().paymentId)!;
  const { payload, signature } = signedEvent({
    id: `evt_${Math.random().toString(36).slice(2, 14)}`,
    type: "payment_intent.succeeded",
    payment: {
      providerPaymentId: intentId,
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

  return {
    bookingId: row.id,
    reference,
    intentId,
    totalMinor: row.totalAmountMinor,
  };
}

beforeAll(async () => {
  provider = new FakePaymentProvider();
  app = await createTestApp({
    emailProvider: new FakeEmailProvider(),
    paymentProvider: provider,
  });
  database = app.get<Database>(DATABASE);
  settlements = app.get(SettlementsService);
  notifications = app.get(NotificationsService);
  notificationQueue = app.get<Queue>(NOTIFICATIONS_QUEUE);
  syncQueue = app.get<Queue>(SYNC_QUEUE);

  admin = await registerGuest(app, "admin");
  support = await registerGuest(app, "support");
  guest = await registerGuest(app, "plainguest");
  host = await registerHost(app, "adminhost");
  created.push(admin, support, guest, host);

  await grantRole(database, admin.userId, "ADMIN");
  await grantRole(database, support.userId, "SUPPORT");

  property = await createPublishedProperty(app, host, "Admin Panel Loft", {
    // Instant book, so a Booking reaches PENDING_PAYMENT without a Host decision
    // — the panel is what is under test here, not the approval flow.
    bookingMode: "INSTANT_BOOK",
  });
});

afterAll(async () => {
  await database.db.execute(sql`DELETE FROM admin_actions`);
  await clearFinancials(database);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
  await database.db.execute(sql`DELETE FROM availability_blocks`);
  await database.db.execute(sql`DELETE FROM booking_holds`);
  await database.db.execute(sql`DELETE FROM booking_events`);
  await database.db.execute(sql`DELETE FROM bookings`);
  await cleanupHosts(database, created);
  await app.close();
});

beforeEach(() => {
  provider.reset();
});

describe("admin authorization", () => {
  /**
   * The whole panel behind one server-side guard. Hiding a link is not access
   * control, and every one of these would pass if it were (milestone 11 §4).
   */
  const ROUTES = [
    "/api/admin/dashboard",
    "/api/admin/search?q=RZV",
    "/api/admin/bookings",
    "/api/admin/operations",
    "/api/admin/jobs",
    "/api/admin/notifications",
    "/api/admin/ical",
    "/api/admin/stripe",
    "/api/admin/actions",
    "/api/admin/reconciliation",
  ];

  it("refuses an anonymous caller", async () => {
    for (const url of ROUTES) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("refuses a signed-in User with no role", async () => {
    for (const url of ROUTES) {
      const response = await app.inject({ method: "GET", url, cookies: guest.cookies });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("ADMIN_FORBIDDEN");
    }
  });

  /** Being a Host grants nothing here: the two roles are unrelated. */
  it("refuses a Host", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("ADMIN_FORBIDDEN");
  });

  it("refuses every action endpoint to a Host as well", async () => {
    const actions = [
      ["retry-notification", { notificationId: crypto.randomUUID() }],
      ["retry-refund", { refundId: crypto.randomUUID() }],
      ["retry-transfer", { settlementId: crypto.randomUUID() }],
      ["ical-resync", { externalCalendarId: crypto.randomUUID() }],
      ["refresh-connect", { hostId: crypto.randomUUID() }],
      ["reconcile", { scope: "all" }],
      ["retry-job", { queue: "notifications", jobId: "1" }],
    ] as const;

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

  it("admits ADMIN and SUPPORT alike", async () => {
    for (const staff of [admin, support]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/dashboard",
        cookies: staff.cookies,
      });
      expect(response.statusCode).toBe(200);
    }
  });

  /** A revoked session must lose the panel immediately, not at token expiry. */
  it("loses access the moment the session is revoked", async () => {
    const temporary = await registerGuest(app, "temporary");
    created.push(temporary);
    await grantRole(database, temporary.userId, "ADMIN");

    expect(
      (await app.inject({ method: "GET", url: "/api/admin/dashboard", cookies: temporary.cookies }))
        .statusCode,
    ).toBe(200);

    await app.inject({ method: "POST", url: "/api/auth/logout", cookies: temporary.cookies });

    expect(
      (await app.inject({ method: "GET", url: "/api/admin/dashboard", cookies: temporary.cookies }))
        .statusCode,
    ).toBe(401);
  });
});

describe("global search", () => {
  it("finds a Booking by its reference", async () => {
    const paid = await paidBooking("2029-11-20", "2029-11-24");

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${paid.reference}`,
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    const hit = response.json().items.find((item: { kind: string }) => item.kind === "BOOKING");
    expect(hit).toMatchObject({ id: paid.bookingId, href: `/admin/bookings/${paid.bookingId}` });
  });

  it("finds a User by email and a Host by their account address", async () => {
    const users = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${encodeURIComponent(guest.email)}`,
      cookies: admin.cookies,
    });
    expect(users.json().items.some((item: { kind: string }) => item.kind === "USER")).toBe(true);

    const hosts = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${encodeURIComponent(host.email)}`,
      cookies: admin.cookies,
    });
    expect(hosts.json().items.some((item: { kind: string }) => item.kind === "HOST")).toBe(true);
  });

  it("finds a Property by title and by id", async () => {
    const byTitle = await app.inject({
      method: "GET",
      url: "/api/admin/search?q=Admin%20Panel%20Loft",
      cookies: admin.cookies,
    });
    expect(byTitle.json().items.some((item: { kind: string }) => item.kind === "PROPERTY")).toBe(
      true,
    );

    const byId = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${property.id}`,
      cookies: admin.cookies,
    });
    expect(byId.json().items.some((item: { id: string }) => item.id === property.id)).toBe(true);
  });

  it("finds a Payment by its provider id and leads back to the Booking", async () => {
    const paid = await paidBooking("2029-12-01", "2029-12-05");

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${paid.intentId}`,
      cookies: admin.cookies,
    });

    const hit = response.json().items.find((item: { kind: string }) => item.kind === "PAYMENT");
    expect(hit).toMatchObject({ bookingId: paid.bookingId });
    expect(hit.href).toBe(`/admin/bookings/${paid.bookingId}`);
  });

  it("finds a Settlement and a Transfer by id", async () => {
    const paid = await paidBooking("2029-12-10", "2029-12-14");
    const settlement = await settlements.findByBooking(paid.bookingId);
    expect(settlement).not.toBeNull();

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${settlement!.id}`,
      cookies: admin.cookies,
    });

    expect(
      response.json().items.some((item: { kind: string }) => item.kind === "SETTLEMENT"),
    ).toBe(true);
  });

  /** SQL injection is not a matter of escaping here: nothing is interpolated. */
  it("treats a hostile term as text, not as SQL", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/search?q=${encodeURIComponent("'; DROP TABLE bookings; --")}`,
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);

    const [count] = (await database.db.execute(
      sql`SELECT count(*)::int AS total FROM bookings`,
    )) as unknown as { total: number }[];
    expect(count.total).toBeGreaterThan(0);
  });

  it("rejects a term too short to mean anything", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/search?q=a",
      cookies: admin.cookies,
    });
    expect(response.statusCode).toBe(400);
  });

  /** The search touches nine tables; a stuck keystroke must not be a load test. */
  it("rate limits the search per operator", async () => {
    const burst = await Promise.all(
      Array.from({ length: 45 }, () =>
        app.inject({
          method: "GET",
          url: "/api/admin/search?q=RZV",
          cookies: support.cookies,
        }),
      ),
    );

    expect(burst.some((response) => response.statusCode === 429)).toBe(true);
    const limited = burst.find((response) => response.statusCode === 429)!;
    expect(limited.json().code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();
  });
});

describe("booking lifecycle view", () => {
  it("shows the money in the order it moves", async () => {
    const paid = await paidBooking("2030-01-10", "2030-01-15");
    await deliverConfirmation(paid.bookingId);

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/bookings/${paid.bookingId}`,
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body).toMatchObject({
      reference: paid.reference,
      status: "CONFIRMED",
      propertyTitle: "Admin Panel Loft",
      hostDisplayName: "Test adminhost",
    });
    expect(body.payment).toMatchObject({ status: "SUCCEEDED", providerPaymentId: paid.intentId });
    expect(body.settlement).toMatchObject({ status: "PENDING" });
    expect(Array.isArray(body.refunds)).toBe(true);
    expect(Array.isArray(body.payouts)).toBe(true);
    // The confirmed Booking's claim on the calendar, rewritten in place.
    expect(body.availability.some((block: { source: string }) => block.source === "BOOKING")).toBe(
      true,
    );
    expect(body.notifications.length).toBeGreaterThan(0);
    expect(body.events.length).toBeGreaterThan(0);
  });

  /**
   * Support recognises an address; it does not read everybody's mailbox. The
   * Guest snapshot on a Booking is masked wherever it appears.
   */
  it("masks the Guest address", async () => {
    const paid = await paidBooking("2030-02-10", "2030-02-14");

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/bookings/${paid.bookingId}`,
      cookies: admin.cookies,
    });

    expect(response.json().guestEmailMasked).toBe("a***@example.com");
    expect(response.body).not.toContain("anna@example.com");
  });

  it("404s on an unknown Booking", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/bookings/${crypto.randomUUID()}`,
      cookies: admin.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("user, host and property views", () => {
  it("never exposes a password hash or a session token", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/users/${host.userId}`,
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("passwordHash");
    expect(response.body).not.toContain("password_hash");
    expect(response.body).not.toContain("tokenHash");
    expect(response.json().sessions).toMatchObject({ active: expect.any(Number) });
  });

  it("shows a Host's Connect readiness, settlements and payouts", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/hosts/${host.hostId}`,
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      displayName: "Test adminhost",
      connectReadiness: expect.any(String),
    });
    expect(Array.isArray(response.json().properties)).toBe(true);
  });

  /**
   * The door code is AES-GCM ciphertext in the database and stays that way.
   * Support may confirm a Host filled the field in, never read it
   * (milestone 11 §8).
   */
  it("says whether access data is configured without revealing it", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/host/properties/${property.id}/sensitive-access`,
      cookies: host.cookies,
      payload: { accessCode: "4821", keyboxLocation: "przy drzwiach", revealOffsetHours: 6 },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/properties/${property.id}`,
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sensitiveAccessConfigured).toBe(true);
    expect(response.body).not.toContain("4821");
    expect(response.body).not.toContain("przy drzwiach");
  });
});

describe("safe operational actions", () => {
  /**
   * A retry re-queues; it does not send. The delivery row's unique dedup key
   * is still what grants the right to send, so a notification that already
   * went out stays sent (milestone 11 §42).
   */
  it("retries a failed notification through the normal pipeline", async () => {
    const paid = await paidBooking("2030-03-10", "2030-03-14");

    const deliveryId = await deliverConfirmation(paid.bookingId);

    await database.db
      .update(notificationDeliveries)
      .set({ status: "FAILED", lastErrorCode: "SMTP_550" })
      .where(eq(notificationDeliveries.id, deliveryId));

    const issues = await app.inject({
      method: "GET",
      url: "/api/admin/operations?category=NOTIFICATION",
      cookies: admin.cookies,
    });
    expect(
      issues.json().items.some((issue: { targetId: string }) => issue.targetId === deliveryId),
    ).toBe(true);

    const retry = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-notification",
      cookies: admin.cookies,
      payload: { notificationId: deliveryId },
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe("SUCCEEDED");

    const [after] = await database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId));

    // Reopened for the pipeline, not marked sent by the panel.
    expect(after.status).toBe("PENDING");
    expect(after.lastErrorCode).toBeNull();

    /*
     * And the job is genuinely back on the queue. BullMQ treats `add` with a
     * job id it has seen as a no-op — which is what makes the ordinary enqueue
     * safe to call twice, and what would silently make this retry do nothing.
     */
    const job = await notificationQueue.getJob("notify-booking-confirmed-" + paid.bookingId);
    expect(job).toBeDefined();
    expect(job!.data).toMatchObject({ bookingId: paid.bookingId, type: "BOOKING_CONFIRMED" });

    // Twice in a row still leaves a live job, rather than silently doing nothing.
    const again = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-notification",
      cookies: admin.cookies,
      payload: { notificationId: deliveryId },
    });
    expect(again.statusCode).toBe(200);
    expect(
      await notificationQueue.getJob("notify-booking-confirmed-" + paid.bookingId),
    ).toBeDefined();
  });

  it("does not resend a notification that already went out", async () => {
    const paid = await paidBooking("2030-03-20", "2030-03-24");

    const deliveryId = await deliverConfirmation(paid.bookingId);

    await database.db
      .update(notificationDeliveries)
      .set({ status: "SENT", sentAt: new Date() })
      .where(eq(notificationDeliveries.id, deliveryId));

    const retry = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-notification",
      cookies: admin.cookies,
      payload: { notificationId: deliveryId },
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().summary).toContain("już wysłane");

    const [after] = await database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId));
    expect(after.status).toBe("SENT");
  });

  /**
   * The command, not a status write. `prepareTransfer` still claims the row,
   * the partial unique index still allows one live Transfer per Settlement,
   * and the provider still sees the same idempotency key.
   */
  it("retries a transfer through the domain command, idempotently", async () => {
    const paid = await paidBooking("2030-04-10", "2030-04-14");
    const settlement = (await settlements.findByBooking(paid.bookingId))!;

    // The Host must be able to receive money before a transfer can happen.
    await app.inject({
      method: "POST",
      url: "/api/host/payments/connect-account",
      cookies: host.cookies,
    });
    await database.db
      .update(hostPaymentAccounts)
      .set({ onboardingStatus: "READY", chargesEnabled: true, payoutsEnabled: true })
      .where(eq(hostPaymentAccounts.hostId, host.hostId));

    // Release the money the same way the scheduled job would.
    await database.db
      .update(bookingSettlements)
      .set({ releaseAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingSettlements.id, settlement.id));
    await settlements.release(settlement.id);

    const first = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-transfer",
      cookies: admin.cookies,
      payload: { settlementId: settlement.id },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().summary).toContain("Przelew wykonany");
    expect(provider.transfers).toHaveLength(1);

    const second = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-transfer",
      cookies: admin.cookies,
      payload: { settlementId: settlement.id },
    });

    // Asking twice pays the Host once.
    expect(second.statusCode).toBe(200);
    expect(second.json().summary).toContain("już przelane");
    expect(provider.transfers).toHaveLength(1);
  });

  it("refuses a transfer whose Host cannot be paid yet, with a code that says so", async () => {
    const stranger = await registerHost(app, "notready");
    created.push(stranger);
    const strangerProperty = await createPublishedProperty(app, stranger, "Not Ready Loft", {
      bookingMode: "INSTANT_BOOK",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "idempotency-key": nextKey() },
      payload: {
        propertyId: strangerProperty.id,
        checkIn: "2030-05-10",
        checkOut: "2030-05-14",
        adults: 2,
        guest: { name: "Jan Kowalski", email: "jan@example.com" },
      },
    });
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
        providerPaymentId: provider.intentFor(started.json().paymentId)!,
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

    const [booking] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.publicReference, reference));
    const settlement = (await settlements.findByBooking(booking.id))!;

    await database.db
      .update(bookingSettlements)
      .set({ releaseAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingSettlements.id, settlement.id));
    await settlements.release(settlement.id);

    const retry = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-transfer",
      cookies: admin.cookies,
      payload: { settlementId: settlement.id },
    });

    expect(retry.statusCode).toBe(409);
    expect(retry.json().code).toBe("HOST_PAYMENT_ACCOUNT_NOT_READY");
  });

  it("retries a failed refund through the normal command", async () => {
    const paid = await paidBooking("2030-06-10", "2030-06-14");

    const [payment] = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, paid.bookingId));

    const [refund] = await database.db
      .insert(refunds)
      .values({
        paymentId: payment.id,
        bookingId: paid.bookingId,
        type: "FULL",
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reason: "HOST_CANCELLED",
        status: "FAILED",
        failureCode: "PROVIDER_DOWN",
      })
      .returning();

    const issues = await app.inject({
      method: "GET",
      url: "/api/admin/operations?category=REFUND",
      cookies: admin.cookies,
    });
    expect(issues.json().items.some((issue: { targetId: string }) => issue.targetId === refund.id))
      .toBe(true);

    const retry = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-refund",
      cookies: admin.cookies,
      payload: { refundId: refund.id },
    });

    expect(retry.statusCode).toBe(200);
    expect(provider.refunds.some((call) => call.refundId === refund.id)).toBe(true);

    const [after] = await database.db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(after.status).toBe("SUCCEEDED");
  });

  it("resyncs a calendar through the existing sync queue", async () => {
    const calendar = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/external-calendars`,
      cookies: host.cookies,
      payload: {
        provider: "AIRBNB",
        name: "Airbnb",
        importUrl: "https://calendar.example.test/feed.ics",
      },
    });

    expect(calendar.statusCode).toBe(201);
    const calendarId = calendar.json().id as string;

    /*
     * Adding the calendar already queued a sync, and the worker is off in the
     * suite — so this press joins the pending job rather than queueing a
     * second one, and says so. "Nothing happened" and "it is already coming"
     * look identical to an operator otherwise.
     */
    const pending = await app.inject({
      method: "POST",
      url: "/api/admin/actions/ical-resync",
      cookies: admin.cookies,
      payload: { externalCalendarId: calendarId },
    });

    expect(pending.statusCode).toBe(200);
    expect(pending.json().details).toMatchObject({ queued: false });
    expect(pending.json().summary).toContain("już zaplanowana");

    // Once that job is gone, a resync queues real work again — a stable job id
    // must not turn the first sync of a calendar into its last.
    await (await syncQueue.getJob(`sync-${calendarId}`))!.remove();

    const resync = await app.inject({
      method: "POST",
      url: "/api/admin/actions/ical-resync",
      cookies: admin.cookies,
      payload: { externalCalendarId: calendarId },
    });

    expect(resync.statusCode).toBe(200);
    expect(resync.json().summary).toContain("kolejki");
    expect(resync.json().details).toMatchObject({ queued: true });
    expect(await syncQueue.getJob(`sync-${calendarId}`)).toBeDefined();

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/ical",
      cookies: admin.cookies,
    });
    expect(listed.json().items.some((row: { id: string }) => row.id === calendarId)).toBe(true);
  });

  it("runs reconciliation and reports what it did", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/reconcile",
      cookies: admin.cookies,
      payload: { scope: "all" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().details).toMatchObject({
      scope: "all",
      released: expect.any(Number),
      transfersRepaired: expect.any(Number),
      payoutsObserved: expect.any(Number),
    });

    const status = await app.inject({
      method: "GET",
      url: "/api/admin/reconciliation",
      cookies: admin.cookies,
    });
    expect(status.json().lastRunStatus).toBe("SUCCEEDED");
    expect(status.json().lastRunBy).toBe(admin.email);
  });

  /** Running it twice must not double anything: the sweep is idempotent. */
  it("reconciliation is idempotent", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/admin/actions/reconcile",
      cookies: admin.cookies,
      payload: { scope: "all" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/admin/actions/reconcile",
      cookies: admin.cookies,
      payload: { scope: "all" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().details.transfersRetried).toBe(0);
  });

  it("refuses to retry a job that is not failed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-job",
      cookies: admin.cookies,
      payload: { queue: "notifications", jobId: "does-not-exist" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("JOB_NOT_RETRYABLE");
  });

  it("refuses a queue that is not in the registry", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-job",
      cookies: admin.cookies,
      payload: { queue: "rm-rf", jobId: "1" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("admin action audit", () => {
  it("records who ran what, including the attempts that failed", async () => {
    await app.inject({
      method: "POST",
      url: "/api/admin/actions/reconcile",
      cookies: support.cookies,
      payload: { scope: "settlement" },
    });

    await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-refund",
      cookies: support.cookies,
      payload: { refundId: crypto.randomUUID() },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/actions?limit=20",
      cookies: admin.cookies,
    });

    const items = response.json().items as {
      actionType: string;
      status: string;
      adminEmail: string;
    }[];

    expect(
      items.some(
        (item) =>
          item.actionType === "RECONCILE" &&
          item.status === "SUCCEEDED" &&
          item.adminEmail === support.email,
      ),
    ).toBe(true);

    // A failed action is audited too — otherwise the trail only shows successes.
    expect(
      items.some((item) => item.actionType === "RETRY_REFUND" && item.status === "FAILED"),
    ).toBe(true);
  });

  /**
   * "UNEXPECTED" against a provider refusal would be a lie: the action did
   * exactly what it was asked and Stripe said no. The audit has to tell the
   * two apart (milestone 11 §11, §15).
   */
  it("records a provider refusal as such, not as an unexpected failure", async () => {
    const paid = await paidBooking("2030-08-10", "2030-08-14");
    const settlement = (await settlements.findByBooking(paid.bookingId))!;

    await database.db
      .update(hostPaymentAccounts)
      .set({ onboardingStatus: "READY", chargesEnabled: true, payoutsEnabled: true })
      .where(eq(hostPaymentAccounts.hostId, host.hostId));
    await database.db
      .update(bookingSettlements)
      .set({ releaseAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingSettlements.id, settlement.id));
    await settlements.release(settlement.id);

    provider.failTransfers(1);

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-transfer",
      cookies: admin.cookies,
      payload: { settlementId: settlement.id },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("PAYMENT_PROVIDER_ERROR");

    const [audited] = await database.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, settlement.id))
      .orderBy(desc(adminActions.createdAt))
      .limit(1);

    expect(audited.status).toBe("FAILED");
    expect(audited.metadataJson).toContain("PAYMENT_PROVIDER_ERROR");
    expect(audited.metadataJson).not.toContain("UNEXPECTED");
  });

  it("never writes a secret into the audit metadata", async () => {
    const rows = await database.db.select().from(adminActions);
    const blob = JSON.stringify(rows);

    expect(blob).not.toMatch(/sk_(test|live)_/);
    expect(blob).not.toMatch(/whsec_/);
    expect(blob).not.toContain("password");
  });

  it("shows the actions taken against one Booking on its lifecycle view", async () => {
    const paid = await paidBooking("2030-07-10", "2030-07-14");
    const settlement = (await settlements.findByBooking(paid.bookingId))!;

    await app.inject({
      method: "POST",
      url: "/api/admin/actions/retry-transfer",
      cookies: admin.cookies,
      payload: { settlementId: settlement.id },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/bookings/${paid.bookingId}`,
      cookies: admin.cookies,
    });

    // The audit is keyed by Settlement, so the Booking view carries its own
    // actions; the Settlement's live on the operations screen.
    expect(Array.isArray(response.json().adminActions)).toBe(true);
  });
});

describe("Stripe sandbox", () => {
  it("reports test mode and never live", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/stripe",
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ testMode: true });
    expect(response.json().mode).not.toBe("LIVE");
  });

  it("puts the same badge on the dashboard", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
      cookies: admin.cookies,
    });

    expect(response.json().stripe.testMode).toBe(true);
  });

  /** There is no route that would switch the provider to live. */
  it("exposes no way to enable live payments", async () => {
    const document = await app.inject({ method: "GET", url: "/api/openapi.json" });
    const paths = Object.keys(document.json().paths as Record<string, unknown>);

    expect(paths.filter((path) => /live|go-live/i.test(path))).toEqual([]);
  });
});

describe("dashboard and job visibility", () => {
  it("answers the whole front page in one request", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
      cookies: admin.cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.stripe).toBeDefined();
    expect(Array.isArray(body.issueCounts)).toBe(true);
    expect(Array.isArray(body.recentBookings)).toBe(true);
    expect(Array.isArray(body.failedJobs)).toBe(true);
    expect(body.reconciliation).toMatchObject({ intervalMinutes: expect.any(Number) });
  });

  it("names every queue in the registry and reports whether it answered", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/jobs",
      cookies: admin.cookies,
    });

    const names = response.json().queues.map((queue: { name: string }) => queue.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "calendar-sync",
        "notifications",
        "payment-refund",
        "stay-lifecycle",
        "host-settlement",
      ]),
    );
    expect(response.json().queues.every((queue: { reachable: boolean }) => queue.reachable)).toBe(
      true,
    );
  });
});
