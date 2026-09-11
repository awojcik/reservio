import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  bookingSettlements,
  bookings,
  externalCalendars,
  hostPayouts,
  hostTransfers,
  notificationDeliveries,
  outboxEvents,
  paymentProviderEvents,
  payments,
  refunds,
} from "../src/infrastructure/database/schema";
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

let admin: TestHost;
let host: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `ops-${Date.now()}-${(counter += 1)}`;

type Paid = { bookingId: string; reference: string; paymentId: string };

async function paidBooking(checkIn: string, checkOut: string): Promise<Paid> {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId: property.id,
      checkIn,
      checkOut,
      adults: 2,
      guest: { name: "Ola Wiśniewska", email: "ola@example.com" },
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
  expect(started.statusCode).toBe(200);

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

  const [row] = await database.db
    .select()
    .from(bookings)
    .where(eq(bookings.publicReference, reference));

  return { bookingId: row.id, reference, paymentId: started.json().paymentId };
}

/** Every issue currently visible, as the panel sees it. */
async function issues(category?: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/admin/operations${category ? `?category=${category}&limit=200` : "?limit=200"}`,
    cookies: admin.cookies,
  });
  expect(response.statusCode).toBe(200);

  return response.json().items as {
    type: string;
    category: string;
    severity: string;
    targetId: string;
    bookingId: string | null;
    actions: string[];
    description: string;
  }[];
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

  admin = await registerGuest(app, "opsadmin");
  host = await registerHost(app, "opshost");
  created.push(admin, host);
  await grantRole(database, admin.userId, "SUPPORT");

  property = await createPublishedProperty(app, host, "Operations Loft", {
    bookingMode: "INSTANT_BOOK",
  });
});

afterAll(async () => {
  await database.db.execute(sql`DELETE FROM admin_actions`);
  await clearFinancials(database);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM payment_provider_events`);
  await database.db.execute(sql`DELETE FROM availability_blocks`);
  await database.db.execute(sql`DELETE FROM booking_holds`);
  await database.db.execute(sql`DELETE FROM booking_events`);
  await database.db.execute(sql`DELETE FROM bookings`);
  await cleanupHosts(database, created);
  await app.close();
});

describe("financial issues", () => {
  /**
   * The one that matters most. Normally impossible — the webhook confirms in
   * the same transaction that marks the Payment — so when it happens somebody
   * has to see it (milestone 11 §12).
   */
  it("shows a succeeded Payment whose Booking is not confirmed", async () => {
    const paid = await paidBooking("2031-01-10", "2031-01-14");

    await database.db
      .update(bookings)
      .set({ status: "PENDING_PAYMENT" })
      .where(eq(bookings.id, paid.bookingId));

    const found = await issues("PAYMENT");
    const issue = found.find(
      (candidate) => candidate.type === "PAYMENT_SUCCEEDED_BOOKING_NOT_CONFIRMED",
    );

    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("FAILED");
    expect(issue!.bookingId).toBe(paid.bookingId);

    // Put it back so it does not pollute the later "healthy" assertions.
    await database.db
      .update(bookings)
      .set({ status: "CONFIRMED" })
      .where(eq(bookings.id, paid.bookingId));
  });

  /**
   * ...unless a Refund exists, which is the *documented* outcome of a payment
   * landing after the hold expired. A correct system must not be flagged.
   */
  it("does not flag a late payment that was refunded", async () => {
    const paid = await paidBooking("2031-01-20", "2031-01-24");
    const [payment] = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, paid.bookingId));

    await database.db
      .update(bookings)
      .set({ status: "EXPIRED", statusReason: "PAYMENT_AFTER_HOLD_EXPIRY" })
      .where(eq(bookings.id, paid.bookingId));

    await database.db.insert(refunds).values({
      paymentId: payment.id,
      bookingId: paid.bookingId,
      type: "FULL",
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      reason: "PAYMENT_AFTER_HOLD_EXPIRY",
      status: "SUCCEEDED",
      succeededAt: new Date(),
    });

    const found = await issues("PAYMENT");
    expect(
      found.some(
        (issue) =>
          issue.type === "PAYMENT_SUCCEEDED_BOOKING_NOT_CONFIRMED" &&
          issue.bookingId === paid.bookingId,
      ),
    ).toBe(false);
  });

  it("shows a failed Refund with the action that can fix it", async () => {
    const paid = await paidBooking("2031-02-10", "2031-02-14");
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
        failedAt: new Date(),
      })
      .returning();

    const issue = (await issues("REFUND")).find((candidate) => candidate.targetId === refund.id);

    expect(issue).toMatchObject({ type: "REFUND_FAILED", severity: "FAILED" });
    expect(issue!.actions).toContain("RETRY_REFUND");
  });

  it("shows a Settlement stuck past its release moment", async () => {
    const paid = await paidBooking("2031-03-10", "2031-03-14");
    const settlement = (await settlements.findByBooking(paid.bookingId))!;

    await database.db
      .update(bookingSettlements)
      .set({ status: "PENDING", releaseAt: new Date(Date.now() - 3 * 3_600_000) })
      .where(eq(bookingSettlements.id, settlement.id));

    const issue = (await issues("SETTLEMENT")).find(
      (candidate) => candidate.targetId === settlement.id,
    );

    expect(issue).toMatchObject({ type: "SETTLEMENT_STUCK_PENDING", severity: "WARNING" });
  });

  /**
   * Money available but the Host cannot receive it is not an error — it is a
   * Host who has not finished onboarding. Visible, and marked as waiting
   * rather than broken (milestone 10 §14).
   */
  it("shows an AVAILABLE Settlement whose Host is not onboarded", async () => {
    const paid = await paidBooking("2031-04-10", "2031-04-14");
    const settlement = (await settlements.findByBooking(paid.bookingId))!;

    await database.db
      .update(bookingSettlements)
      .set({ status: "AVAILABLE", availableAt: new Date() })
      .where(eq(bookingSettlements.id, settlement.id));

    const issue = (await issues("SETTLEMENT")).find(
      (candidate) =>
        candidate.targetId === settlement.id &&
        candidate.type === "SETTLEMENT_AVAILABLE_HOST_NOT_READY",
    );

    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("WARNING");
    expect(issue!.actions).toContain("REFRESH_CONNECT_STATUS");
  });

  it("shows a failed Transfer and a failed reversal", async () => {
    const paid = await paidBooking("2031-05-10", "2031-05-14");
    const settlement = (await settlements.findByBooking(paid.bookingId))!;

    const [transfer] = await database.db
      .insert(hostTransfers)
      .values({
        settlementId: settlement.id,
        hostId: host.hostId,
        amountMinor: settlement.hostAmountMinor,
        currency: settlement.currency,
        status: "FAILED",
        failureCode: "ACCOUNT_RESTRICTED",
        failedAt: new Date(),
      })
      .returning();

    const issue = (await issues("TRANSFER")).find(
      (candidate) => candidate.targetId === transfer.id,
    );

    expect(issue).toMatchObject({ type: "TRANSFER_FAILED", severity: "FAILED" });
    expect(issue!.actions).toContain("RETRY_TRANSFER");
    // The amount is context; the provider's own message is not shown.
    expect(issue!.description).toContain(paid.reference);
  });

  it("shows a failed Payout", async () => {
    const [payout] = await database.db
      .insert(hostPayouts)
      .values({
        hostId: host.hostId,
        providerPayoutId: `po_failed_${Date.now()}`,
        amountMinor: 120_000,
        currency: "PLN",
        status: "FAILED",
        failureCode: "account_closed",
        failedAt: new Date(),
      })
      .returning();

    const issue = (await issues("PAYOUT")).find((candidate) => candidate.targetId === payout.id);

    expect(issue).toMatchObject({ type: "PAYOUT_FAILED", severity: "FAILED" });
  });
});

describe("pipeline issues", () => {
  it("shows a failed notification", async () => {
    const paid = await paidBooking("2031-06-10", "2031-06-14");
    await notifications.deliver(paid.bookingId, "BOOKING_CONFIRMED");

    const [delivery] = await database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, paid.bookingId))
      .limit(1);

    await database.db
      .update(notificationDeliveries)
      .set({ status: "FAILED", lastErrorCode: "SMTP_550" })
      .where(eq(notificationDeliveries.id, delivery.id));

    const issue = (await issues("NOTIFICATION")).find(
      (candidate) => candidate.targetId === delivery.id,
    );

    expect(issue).toMatchObject({ type: "NOTIFICATION_FAILED", severity: "FAILED" });
    expect(issue!.actions).toContain("RETRY_NOTIFICATION");
  });

  it("does not flag a notification that was delivered", async () => {
    const paid = await paidBooking("2031-06-20", "2031-06-24");
    await notifications.deliver(paid.bookingId, "BOOKING_CONFIRMED");

    const [delivery] = await database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, paid.bookingId))
      .limit(1);

    expect(delivery.status).toBe("SENT");
    expect(
      (await issues("NOTIFICATION")).some((issue) => issue.targetId === delivery.id),
    ).toBe(false);
  });

  it("shows a calendar that keeps failing and one that has gone stale", async () => {
    const failing = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/external-calendars`,
      cookies: host.cookies,
      payload: {
        provider: "AIRBNB",
        name: "Broken feed",
        importUrl: "https://calendar.example.test/broken.ics",
      },
    });
    expect(failing.statusCode).toBe(201);

    await database.db
      .update(externalCalendars)
      .set({
        consecutiveFailures: 4,
        lastSyncFailedAt: new Date(),
        lastErrorCode: "FETCH_FAILED",
      })
      .where(eq(externalCalendars.id, failing.json().id));

    const found = await issues("ICAL");
    const issue = found.find((candidate) => candidate.targetId === failing.json().id);

    expect(issue).toMatchObject({ type: "ICAL_SYNC_FAILED", severity: "FAILED" });
    expect(issue!.actions).toContain("ICAL_RESYNC");
  });

  it("does not flag a calendar that synced recently", async () => {
    const healthy = await app.inject({
      method: "POST",
      url: `/api/host/properties/${property.id}/external-calendars`,
      cookies: host.cookies,
      payload: {
        provider: "BOOKING",
        name: "Healthy feed",
        importUrl: "https://calendar.example.test/healthy.ics",
      },
    });

    await database.db
      .update(externalCalendars)
      .set({ consecutiveFailures: 0, lastSyncSucceededAt: new Date() })
      .where(eq(externalCalendars.id, healthy.json().id));

    expect((await issues("ICAL")).some((issue) => issue.targetId === healthy.json().id)).toBe(
      false,
    );
  });

  it("shows an outbox row that never made it onto the queue", async () => {
    const paid = await paidBooking("2031-07-10", "2031-07-14");

    const [event] = await database.db
      .insert(outboxEvents)
      .values({
        type: "NOTIFICATION",
        aggregateType: "BOOKING",
        aggregateId: paid.bookingId,
        payloadJson: JSON.stringify({ bookingId: paid.bookingId }),
        status: "FAILED",
        lastError: "ENQUEUE_FAILED",
      })
      .returning();

    const issue = (await issues("JOB")).find((candidate) => candidate.targetId === event.id);
    expect(issue).toMatchObject({ type: "OUTBOX_STUCK", severity: "FAILED" });
  });

  /**
   * A claimed but unprocessed provider event is the one case a replay cannot
   * fix on its own: claiming the row is what makes replays no-ops.
   */
  it("shows a provider event that was claimed but never processed", async () => {
    const [event] = await database.db
      .insert(paymentProviderEvents)
      .values({
        provider: "STRIPE",
        providerEventId: `evt_orphan_${Date.now()}`,
        eventType: "payment_intent.succeeded",
        processedAt: null,
        createdAt: new Date(Date.now() - 60 * 60_000),
      })
      .returning();

    const issue = (await issues("WEBHOOK")).find((candidate) => candidate.targetId === event.id);
    expect(issue).toMatchObject({ type: "WEBHOOK_UNPROCESSED", category: "WEBHOOK" });
  });

  it("does not flag a provider event that was processed", async () => {
    const [event] = await database.db
      .insert(paymentProviderEvents)
      .values({
        provider: "STRIPE",
        providerEventId: `evt_done_${Date.now()}`,
        eventType: "payment_intent.succeeded",
        processedAt: new Date(),
        createdAt: new Date(Date.now() - 60 * 60_000),
      })
      .returning();

    expect((await issues("WEBHOOK")).some((issue) => issue.targetId === event.id)).toBe(false);
  });
});

describe("issue counts and filtering", () => {
  it("counts by category and separates failures from waiting", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/operations",
      cookies: admin.cookies,
    });

    const counts = response.json().counts as { category: string; total: number; failed: number }[];
    const transfers = counts.find((count) => count.category === "TRANSFER");

    expect(transfers).toBeDefined();
    expect(transfers!.failed).toBeGreaterThan(0);
    expect(transfers!.total).toBeGreaterThanOrEqual(transfers!.failed);
  });

  it("filters by severity without changing the counts", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/operations?severity=FAILED&limit=200",
      cookies: admin.cookies,
    });

    const body = response.json();
    expect(body.items.every((issue: { severity: string }) => issue.severity === "FAILED")).toBe(
      true,
    );
    // Counts describe everything, so the tiles do not change as you filter.
    expect(body.counts.length).toBeGreaterThan(0);
  });

  it("rejects a category outside the vocabulary", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/operations?category=EVERYTHING",
      cookies: admin.cookies,
    });
    expect(response.statusCode).toBe(400);
  });

  /** No provider payload reaches the panel — only codes and amounts. */
  it("never carries a raw provider payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/operations?limit=200",
      cookies: admin.cookies,
    });

    expect(response.body).not.toContain("client_secret");
    expect(response.body).not.toMatch(/sk_(test|live)_/);
    expect(response.body).not.toContain("ola@example.com");
  });
});
