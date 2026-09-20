import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  availabilityBlocks,
  bookingHolds,
  bookings,
  hostPaymentAccounts,
  paymentProviderEvents,
  payments,
  properties,
  refunds,
} from "../src/infrastructure/database/schema";
import { PaymentsService } from "../src/modules/payments/payments.service";
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
import { FakePaymentProvider, signedEvent } from "./helpers/fake-payment-provider";

let app: NestFastifyApplication;
let database: Database;
let provider: FakePaymentProvider;
let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `pay-${Date.now()}-${(counter += 1)}`;

/** Nest nests a structured error payload under `message`; some paths flatten it. */
function errorCode(response: { json: () => { code?: string; message?: { code?: string } } }) {
  const body = response.json();
  return body.code ?? body.message?.code;
}

/** An INSTANT_BOOK Booking sitting in PENDING_PAYMENT with a live hold. */
async function payableBooking(
  checkIn = "2029-10-10",
  checkOut = "2029-10-14",
): Promise<{ reference: string; id: string; token: string; totalAmountMinor: number }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/bookings",
    headers: { "idempotency-key": nextKey() },
    payload: {
      propertyId: property.id,
      checkIn,
      checkOut,
      adults: 2,
      guest: { name: "Jan Kowalski", email: "jan@example.com" },
    },
  });

  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(body.status).toBe("PENDING_PAYMENT");

  // The access cookie the Guest is given on creation is their proof of access.
  const cookie = response.cookies.find((c) => c.name === "rezervio_booking_access");
  const [row] = await database.db
    .select()
    .from(bookings)
    .where(eq(bookings.publicReference, body.reference));

  return {
    reference: body.reference,
    id: row.id,
    token: cookie!.value,
    totalAmountMinor: row.totalAmountMinor,
  };
}

async function startPayment(booking: { reference: string; token: string }) {
  return app.inject({
    method: "POST",
    url: `/api/bookings/${booking.reference}/payment`,
    cookies: { rezervio_booking_access: booking.token },
  });
}

/** Posts a signed provider event, exactly as the provider would. */
async function postEvent(event: Parameters<typeof signedEvent>[0]) {
  const { payload, signature } = signedEvent(event);

  return app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });
}

async function succeededEvent(
  providerPaymentId: string,
  amountMinor: number,
  overrides: { id?: string; currency?: string } = {},
) {
  return postEvent({
    id: overrides.id ?? `evt_${Math.random().toString(36).slice(2, 14)}`,
    type: "payment_intent.succeeded",
    payment: {
      providerPaymentId,
      amountMinor,
      currency: overrides.currency ?? "PLN",
      status: "SUCCEEDED",
    },
  });
}

async function paymentRow(bookingId: string) {
  const [row] = await database.db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId));
  return row;
}

async function bookingRow(bookingId: string) {
  const [row] = await database.db.select().from(bookings).where(eq(bookings.id, bookingId));
  return row;
}

async function holdRow(bookingId: string) {
  const [row] = await database.db
    .select()
    .from(bookingHolds)
    .where(eq(bookingHolds.bookingId, bookingId));
  return row;
}

async function blocksFor(propertyId: string) {
  return database.db
    .select()
    .from(availabilityBlocks)
    .where(eq(availabilityBlocks.propertyId, propertyId));
}

async function reset() {
  await database.db.delete(availabilityBlocks);
  await database.db.delete(bookingHolds);
  await clearFinancials(database);
  await database.db.delete(bookings);
  await database.db.delete(paymentProviderEvents);
  await database.db.delete(hostPaymentAccounts);
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
}

beforeAll(async () => {
  provider = new FakePaymentProvider();
  app = await createTestApp({
    emailProvider: new FakeEmailProvider(),
    paymentProvider: provider,
  });
  database = app.get<Database>(DATABASE);

  host = await registerHost(app, "pay-owner");
  stranger = await registerHost(app, "pay-stranger");
  created.push(host, stranger);

  property = await createPublishedProperty(app, host, "Sea View Loft");
  await database.db
    .update(properties)
    .set({ bookingMode: "INSTANT_BOOK" })
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

describe("starting a payment", () => {
  it("creates a Payment for the amount in the Booking snapshot", async () => {
    const booking = await payableBooking();
    const response = await startPayment(booking);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.amountMinor).toBe(booking.totalAmountMinor);
    expect(body.currency).toBe("PLN");
    expect(body.clientSecret).toContain("_secret");

    const payment = await paymentRow(booking.id);
    expect(payment.amountMinor).toBe(booking.totalAmountMinor);
    expect(payment.status).toBe("CREATED");
  });

  it("ignores any amount the client proposes", async () => {
    const booking = await payableBooking();

    const response = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment`,
      cookies: { rezervio_booking_access: booking.token },
      payload: { amountMinor: 1, currency: "PLN" },
    });

    expect(response.json().amountMinor).toBe(booking.totalAmountMinor);
    expect(provider.created.at(-1)!.amountMinor).toBe(booking.totalAmountMinor);
  });

  it("resumes the same Payment when the Guest tries again", async () => {
    const booking = await payableBooking();

    const first = await startPayment(booking);
    const second = await startPayment(booking);

    expect(second.json().paymentId).toBe(first.json().paymentId);

    const rows = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    expect(rows).toHaveLength(1);

    // The provider is asked twice but under one idempotency key, so one intent.
    expect(provider.intentFor(first.json().paymentId)).toBe(
      provider.intentFor(second.json().paymentId),
    );
  });

  it("refuses once the hold has expired", async () => {
    const booking = await payableBooking();
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.bookingId, booking.id));

    const response = await startPayment(booking);

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("BOOKING_HOLD_EXPIRED");
  });

  it("refuses a Booking that is not awaiting payment", async () => {
    const booking = await payableBooking();
    await database.db
      .update(bookings)
      .set({ status: "CONFIRMED" })
      .where(eq(bookings.id, booking.id));

    const response = await startPayment(booking);
    expect(response.statusCode).toBe(409);
  });

  it("needs Guest access, not just the reference", async () => {
    const booking = await payableBooking();

    const anonymous = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment`,
    });
    expect(anonymous.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment`,
      cookies: { rezervio_booking_access: "nie-ten-token" },
    });
    expect(wrongToken.statusCode).toBe(401);
  });
});

describe("webhook endpoint", () => {
  it("accepts a correctly signed event", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const response = await succeededEvent(intent, booking.totalAmountMinor);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: true, duplicate: false });
  });

  it("rejects a forged signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=deadbeef",
      },
      payload: JSON.stringify({ id: "evt_forged", type: "payment_intent.succeeded" }),
    });

    expect(response.statusCode).toBe(400);
    expect(errorCode(response)).toBe("SIGNATURE_INVALID");
  });

  it("rejects a missing signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: "evt_bare", type: "payment_intent.succeeded" }),
    });

    expect(response.statusCode).toBe(400);
    expect(errorCode(response)).toBe("SIGNATURE_MISSING");
  });

  it("needs no session at all", async () => {
    // The caller is the provider, not a browser: what authorises the request
    // is the signature, and nothing else.
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const response = await succeededEvent(intent, booking.totalAmountMinor);
    expect(response.statusCode).toBe(200);
  });
});

describe("confirmation", () => {
  it("confirms the Booking and converts the hold into a Booking block", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    await succeededEvent(intent, booking.totalAmountMinor);

    expect((await paymentRow(booking.id)).status).toBe("SUCCEEDED");

    const confirmed = await bookingRow(booking.id);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).not.toBeNull();

    expect((await holdRow(booking.id)).status).toBe("CONVERTED");

    const blocks = await blocksFor(property.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      sourceType: "BOOKING",
      bookingHoldId: null,
      bookingId: booking.id,
    });
  });

  it("keeps the Stay blocked for the whole conversion", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const overlapping = async () => {
      const [row] = (await database.db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM availability_blocks ab
          LEFT JOIN booking_holds bh ON bh.id = ab.booking_hold_id
          WHERE ab.property_id = ${property.id}
            AND ab.date_range && daterange('2029-10-10'::date, '2029-10-14'::date, '[)')
            AND (ab.booking_hold_id IS NULL
                 OR (bh.status = 'ACTIVE' AND bh.expires_at > now()))
        ) AS blocked
      `)) as unknown as { blocked: boolean }[];
      return row.blocked;
    };

    expect(await overlapping()).toBe(true);
    await succeededEvent(intent, booking.totalAmountMinor);
    // The block row was rewritten in place, never deleted and re-inserted, so
    // the dates were never free to a concurrent reader.
    expect(await overlapping()).toBe(true);
  });

  it("keeps the Property out of Search once confirmed", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    await succeededEvent(
      provider.intentFor(started.json().paymentId)!,
      booking.totalAmountMinor,
    );

    const search = await app.inject({
      method: "GET",
      url: "/api/search?checkIn=2029-10-11&checkOut=2029-10-13&adults=2&limit=200",
    });

    const slugs = search.json().items.map((item: { slug: string }) => item.slug);
    expect(slugs).not.toContain(property.slug);
  });

  it("blocks a second overlapping Booking after confirmation", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    await succeededEvent(
      provider.intentFor(started.json().paymentId)!,
      booking.totalAmountMinor,
    );

    const second = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "idempotency-key": nextKey() },
      payload: {
        propertyId: property.id,
        checkIn: "2029-10-12",
        checkOut: "2029-10-16",
        adults: 2,
        guest: { name: "Ewa Nowak", email: "ewa@example.com" },
      },
    });

    expect(second.statusCode).toBe(409);
  });

  it("has no second effect when the same event is replayed", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const first = await succeededEvent(intent, booking.totalAmountMinor, { id: "evt_dup" });
    const replay = await succeededEvent(intent, booking.totalAmountMinor, { id: "evt_dup" });

    expect(first.json().duplicate).toBe(false);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicate).toBe(true);

    expect(await blocksFor(property.id)).toHaveLength(1);
    const events = await database.db.select().from(paymentProviderEvents);
    expect(events).toHaveLength(1);
    expect(await database.db.select().from(refunds)).toHaveLength(0);
  });

  it("is a no-op when a different event arrives for an already confirmed Booking", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    await succeededEvent(intent, booking.totalAmountMinor, { id: "evt_one" });
    const confirmedAt = (await bookingRow(booking.id)).confirmedAt;

    await succeededEvent(intent, booking.totalAmountMinor, { id: "evt_two" });

    expect((await bookingRow(booking.id)).confirmedAt).toEqual(confirmedAt);
    expect(await blocksFor(property.id)).toHaveLength(1);
  });
});

describe("amount mismatch", () => {
  it("does not confirm, and sends the money back", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    await succeededEvent(intent, booking.totalAmountMinor - 100);

    expect((await bookingRow(booking.id)).status).toBe("PENDING_PAYMENT");

    const [refund] = await database.db.select().from(refunds);
    expect(refund).toMatchObject({ reason: "AMOUNT_MISMATCH", status: "PENDING" });
  });

  it("treats a currency mismatch the same way", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    await succeededEvent(intent, booking.totalAmountMinor, { currency: "EUR" });

    expect((await bookingRow(booking.id)).status).not.toBe("CONFIRMED");
    expect(await database.db.select().from(refunds)).toHaveLength(1);
  });
});

describe("failed payment", () => {
  it("leaves the Booking payable while the hold is alive", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    await postEvent({
      id: "evt_declined",
      type: "payment_intent.payment_failed",
      payment: {
        providerPaymentId: intent,
        amountMinor: booking.totalAmountMinor,
        currency: "PLN",
        status: "FAILED",
        failureCode: "card_declined",
        failureMessage: "Twoja karta została odrzucona.",
      },
    });

    const payment = await paymentRow(booking.id);
    expect(payment.status).toBe("FAILED");
    expect(payment.failureCode).toBe("card_declined");

    // A decline is not a lost Stay (milestone 08 §26).
    expect((await bookingRow(booking.id)).status).toBe("PENDING_PAYMENT");
    expect((await holdRow(booking.id)).status).toBe("ACTIVE");
  });

  it("lets the Guest try again", async () => {
    const booking = await payableBooking();
    const first = await startPayment(booking);
    const intent = provider.intentFor(first.json().paymentId)!;

    await postEvent({
      id: "evt_declined_2",
      type: "payment_intent.payment_failed",
      payment: {
        providerPaymentId: intent,
        amountMinor: booking.totalAmountMinor,
        currency: "PLN",
        status: "FAILED",
        failureCode: "card_declined",
      },
    });

    const retry = await startPayment(booking);
    expect(retry.statusCode).toBe(200);
    // A fresh attempt, because the previous one reached a terminal state.
    expect(retry.json().paymentId).not.toBe(first.json().paymentId);

    await succeededEvent(
      provider.intentFor(retry.json().paymentId)!,
      booking.totalAmountMinor,
    );
    expect((await bookingRow(booking.id)).status).toBe("CONFIRMED");
  });

  it("refuses a retry once the hold has expired", async () => {
    const booking = await payableBooking();
    await startPayment(booking);

    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.bookingId, booking.id));

    const retry = await startPayment(booking);
    expect(retry.statusCode).toBe(409);
    expect(errorCode(retry)).toBe("BOOKING_HOLD_EXPIRED");
  });
});

describe("hold expiry versus a successful payment", () => {
  it("confirms when the webhook gets there first", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    await succeededEvent(intent, booking.totalAmountMinor);

    // The expiry job now runs late — the hold is CONVERTED, not ACTIVE.
    const service = app.get(PaymentsService);
    expect(service).toBeDefined();
    const hold = await holdRow(booking.id);
    const { BookingsService } = await import("../src/modules/bookings/bookings.service");
    await app.get(BookingsService).expireBookingHold(hold.id);

    expect((await bookingRow(booking.id)).status).toBe("CONFIRMED");
    expect(await database.db.select().from(refunds)).toHaveLength(0);
    expect(await blocksFor(property.id)).toHaveLength(1);
  });

  it("refunds in full when the expiry gets there first", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const hold = await holdRow(booking.id);
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));

    const { BookingsService } = await import("../src/modules/bookings/bookings.service");
    await app.get(BookingsService).expireBookingHold(hold.id);

    // The money arrives anyway; the Stay is gone.
    await succeededEvent(intent, booking.totalAmountMinor);

    const booked = await bookingRow(booking.id);
    expect(booked.status).toBe("EXPIRED");
    expect((await paymentRow(booking.id)).status).toBe("REFUND_PENDING");

    const rows = await database.db.select().from(refunds);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "FULL",
      reason: "PAYMENT_AFTER_HOLD_EXPIRY",
      amountMinor: booking.totalAmountMinor,
    });

    // No BOOKING block was ever created for a Stay that expired.
    expect(await blocksFor(property.id)).toHaveLength(0);
  });

  it("asks for exactly one refund even if the event is delivered twice", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const hold = await holdRow(booking.id);
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));
    const { BookingsService } = await import("../src/modules/bookings/bookings.service");
    await app.get(BookingsService).expireBookingHold(hold.id);

    await succeededEvent(intent, booking.totalAmountMinor, { id: "evt_late_1" });
    await succeededEvent(intent, booking.totalAmountMinor, { id: "evt_late_2" });

    expect(await database.db.select().from(refunds)).toHaveLength(1);
  });
});

describe("refund worker", () => {
  async function lateRefund() {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const hold = await holdRow(booking.id);
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));
    const { BookingsService } = await import("../src/modules/bookings/bookings.service");
    await app.get(BookingsService).expireBookingHold(hold.id);
    await succeededEvent(intent, booking.totalAmountMinor);

    const [refund] = await database.db.select().from(refunds);
    return { refund, booking };
  }

  it("sends the refund to the provider exactly once", async () => {
    const { refund } = await lateRefund();
    const before = provider.refunds.length;

    await app.get(PaymentsService).processRefund(refund.id);
    await app.get(PaymentsService).processRefund(refund.id);

    // The second call sees SUCCEEDED and does nothing.
    expect(provider.refunds.length - before).toBe(1);

    const [after] = await database.db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(after.status).toBe("SUCCEEDED");
    expect(after.providerRefundId).not.toBeNull();
  });

  it("marks the Payment refunded once the money is back", async () => {
    const { refund, booking } = await lateRefund();
    await app.get(PaymentsService).processRefund(refund.id);

    expect((await paymentRow(booking.id)).status).toBe("REFUNDED");
  });

  it("stays retryable after a temporary provider failure", async () => {
    const { refund } = await lateRefund();
    provider.failRefunds(1);

    await expect(app.get(PaymentsService).processRefund(refund.id)).rejects.toThrow();

    const [pending] = await database.db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refund.id));
    expect(pending.status).toBe("PENDING");

    // The row, not the job, is what says money is owed.
    await app.get(PaymentsService).processRefund(refund.id);
    const [done] = await database.db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(done.status).toBe("SUCCEEDED");
  });
});

describe("provider cancel after expiry", () => {
  it("tells the provider the intent will not be used", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    const before = provider.cancelled.length;
    await app.get(PaymentsService).cancelProviderPayment(started.json().paymentId);

    expect(provider.cancelled.slice(before)).toContain(intent);
    expect((await paymentRow(booking.id)).status).toBe("CANCELLED");
  });

  /**
   * The Guest can finish paying in the seconds between the hold lapsing and
   * this job running. Filing that as a cancel would leave a charged card with
   * no Booking and no Refund — the provider's answer decides, not the fact
   * that we asked (milestone 08 §23, §27).
   */
  it("never files an already-successful payment as cancelled", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const paymentId = started.json().paymentId;
    const intent = provider.intentFor(paymentId)!;

    provider.setIntentState(intent, {
      status: "SUCCEEDED",
      amountMinor: booking.totalAmountMinor,
      currency: "PLN",
    });
    const hold = await holdRow(booking.id);
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.id, hold.id));
    const { BookingsService } = await import("../src/modules/bookings/bookings.service");
    await app.get(BookingsService).expireBookingHold(hold.id);

    await app.get(PaymentsService).cancelProviderPayment(paymentId);

    expect((await paymentRow(booking.id)).status).toBe("REFUND_PENDING");

    const [refund] = await database.db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    expect(refund.reason).toBe("PAYMENT_AFTER_HOLD_EXPIRY");
    expect(refund.amountMinor).toBe(booking.totalAmountMinor);
  });
});

/**
 * A webhook is a push, and a push can be late, lost, or — against a machine
 * with no public address — never sent. The pull is what keeps a Guest whose
 * card was charged from being told the payment failed while their hold runs
 * out (milestone 08 §16, §19).
 */
describe("reconciling with the provider", () => {
  it("confirms a Booking whose webhook never arrived", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    // The money moved. Nothing told us.
    provider.setIntentState(intent, {
      status: "SUCCEEDED",
      amountMinor: booking.totalAmountMinor,
      currency: "PLN",
    });
    expect((await bookingRow(booking.id)).status).toBe("PENDING_PAYMENT");

    const synced = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment/sync`,
      cookies: { rezervio_booking_access: booking.token },
    });

    expect(synced.statusCode).toBe(200);
    expect(synced.json()).toEqual({
      bookingStatus: "CONFIRMED",
      paymentStatus: "SUCCEEDED",
    });
    expect((await bookingRow(booking.id)).confirmedAt).not.toBeNull();
  });

  /**
   * The bug this was written for: Stripe replays the original response for a
   * repeated idempotency key, so resuming blindly handed the browser the
   * client secret of an intent that had already succeeded. Confirming it again
   * fails, and the Guest was told their payment failed after being charged.
   */
  it("refuses to resurrect a PaymentIntent that has already been paid", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    provider.setIntentState(intent, {
      status: "SUCCEEDED",
      amountMinor: booking.totalAmountMinor,
      currency: "PLN",
    });

    const retry = await startPayment(booking);

    expect(retry.statusCode).toBe(409);
    expect(errorCode(retry)).toBe("BOOKING_NOT_PAYABLE");
    expect(retry.json().clientSecret).toBeUndefined();
    expect((await bookingRow(booking.id)).status).toBe("CONFIRMED");
  });

  it("records a decline the provider never announced, and stays payable", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    provider.setIntentState(intent, {
      status: "FAILED",
      failureCode: "card_declined",
      failureMessage: "Your card was declined.",
    });

    const synced = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment/sync`,
      cookies: { rezervio_booking_access: booking.token },
    });

    expect(synced.json()).toEqual({
      bookingStatus: "PENDING_PAYMENT",
      paymentStatus: "FAILED",
    });

    // A declined card is not a lost Stay: the hold is alive, so paying again
    // must still be possible.
    expect((await startPayment(booking)).statusCode).toBe(200);
  });

  it("leaves a payment still in flight alone", async () => {
    const booking = await payableBooking();
    const started = await startPayment(booking);
    const intent = provider.intentFor(started.json().paymentId)!;

    // 3-D Secure in progress is not an outcome; treating it as one would
    // decline every SCA payment in Europe.
    provider.setIntentState(intent, { status: "REQUIRES_ACTION" });

    const synced = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment/sync`,
      cookies: { rezervio_booking_access: booking.token },
    });

    expect(synced.json()).toEqual({
      bookingStatus: "PENDING_PAYMENT",
      paymentStatus: "CREATED",
    });
    expect((await startPayment(booking)).statusCode).toBe(200);
  });

  it("needs Guest access, exactly like everything else about a Booking", async () => {
    const booking = await payableBooking();

    const anonymous = await app.inject({
      method: "POST",
      url: `/api/bookings/${booking.reference}/payment/sync`,
    });

    expect(anonymous.statusCode).toBe(401);
  });
});

describe("Connect foundation", () => {
  it("creates a connected account idempotently", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/host/payments/connect-account",
      cookies: host.cookies,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/host/payments/connect-account",
      cookies: host.cookies,
    });

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());

    const rows = await database.db
      .select()
      .from(hostPaymentAccounts)
      .where(eq(hostPaymentAccounts.hostId, host.hostId));
    expect(rows).toHaveLength(1);
  });

  it("returns a provider-hosted onboarding link", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/host/payments/onboarding-link",
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().url).toContain("connect.example.test");

    const [row] = await database.db
      .select()
      .from(hostPaymentAccounts)
      .where(eq(hostPaymentAccounts.hostId, host.hostId));
    expect(row.onboardingStatus).toBe("IN_PROGRESS");
  });

  it("refreshes readiness from the provider", async () => {
    await app.inject({
      method: "POST",
      url: "/api/host/payments/connect-account",
      cookies: host.cookies,
    });

    provider.setAccountFlags({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const status = await app.inject({
      method: "GET",
      url: "/api/host/payments/status",
      cookies: host.cookies,
    });

    expect(status.json()).toMatchObject({ readiness: "READY", chargesEnabled: true });
  });

  it("reports RESTRICTED when details are in but a capability is withheld", async () => {
    await app.inject({
      method: "POST",
      url: "/api/host/payments/connect-account",
      cookies: host.cookies,
    });

    provider.setAccountFlags({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });

    const status = await app.inject({
      method: "GET",
      url: "/api/host/payments/status",
      cookies: host.cookies,
    });

    expect(status.json().readiness).toBe("RESTRICTED");
  });

  it("never shows one Host another Host's account", async () => {
    await app.inject({
      method: "POST",
      url: "/api/host/payments/connect-account",
      cookies: host.cookies,
    });

    const other = await app.inject({
      method: "GET",
      url: "/api/host/payments/status",
      cookies: stranger.cookies,
    });

    expect(other.json()).toMatchObject({ connected: false, readiness: "NOT_STARTED" });
  });

  it("needs a Host profile", async () => {
    const response = await app.inject({ method: "GET", url: "/api/host/payments/status" });
    expect(response.statusCode).toBe(401);
  });
});

describe("Guest-facing state", () => {
  it("reports the payment state on the Booking", async () => {
    const booking = await payableBooking();
    await startPayment(booking);

    const view = await app.inject({
      method: "GET",
      url: `/api/bookings/${booking.reference}`,
      cookies: { rezervio_booking_access: booking.token },
    });

    expect(view.json().payment).toMatchObject({ status: "CREATED", refunded: false });
    expect(view.json().allowedActions.canPay).toBe(true);
  });

  it("stops offering payment once the hold has expired", async () => {
    const booking = await payableBooking();
    await database.db
      .update(bookingHolds)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(bookingHolds.bookingId, booking.id));

    const view = await app.inject({
      method: "GET",
      url: `/api/bookings/${booking.reference}`,
      cookies: { rezervio_booking_access: booking.token },
    });

    expect(view.json().allowedActions.canPay).toBe(false);
  });
});

describe("true concurrency", () => {
  /**
   * The two racing paths take the same Property advisory lock, so PostgreSQL
   * serialises them. Whichever wins, the outcome must be internally
   * consistent — never a confirmed Booking *and* a refund (milestone 08 §47).
   */
  it("never both confirms and refunds", async () => {
    const { BookingsService } = await import("../src/modules/bookings/bookings.service");

    for (let round = 0; round < 5; round += 1) {
      await reset();

      const booking = await payableBooking();
      const started = await startPayment(booking);
      const intent = provider.intentFor(started.json().paymentId)!;

      // Due right now: both the expiry and the webhook have a real claim.
      const hold = await holdRow(booking.id);
      await database.db
        .update(bookingHolds)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(bookingHolds.id, hold.id));

      await Promise.all([
        app.get(BookingsService).expireBookingHold(hold.id),
        succeededEvent(intent, booking.totalAmountMinor, { id: `evt_race_${round}` }),
      ]);

      const result = await bookingRow(booking.id);
      const refundRows = await database.db.select().from(refunds);
      const blocks = await blocksFor(property.id);

      if (result.status === "CONFIRMED") {
        expect(refundRows).toHaveLength(0);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].sourceType).toBe("BOOKING");
      } else {
        expect(result.status).toBe("EXPIRED");
        expect(refundRows).toHaveLength(1);
        expect(refundRows[0].reason).toBe("PAYMENT_AFTER_HOLD_EXPIRY");
        // Nothing may keep the dates blocked for a Stay that expired.
        expect(blocks.filter((block) => block.sourceType === "BOOKING")).toHaveLength(0);
      }
    }
  });

  /**
   * The conversion must not open a window in which the Stay looks free
   * (milestone 08 §46). A second Guest attempting the same dates at the moment
   * of confirmation has to lose.
   */
  it("lets nobody slip in while the hold becomes a Booking", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();

      const booking = await payableBooking();
      const started = await startPayment(booking);
      const intent = provider.intentFor(started.json().paymentId)!;

      const [, rival] = await Promise.all([
        succeededEvent(intent, booking.totalAmountMinor, { id: `evt_conv_${round}` }),
        app.inject({
          method: "POST",
          url: "/api/bookings",
          headers: { "idempotency-key": nextKey() },
          payload: {
            propertyId: property.id,
            checkIn: "2029-10-11",
            checkOut: "2029-10-13",
            adults: 2,
            guest: { name: "Ewa Nowak", email: "ewa@example.com" },
          },
        }),
      ]);

      expect((await bookingRow(booking.id)).status).toBe("CONFIRMED");
      expect(rival.statusCode).toBe(409);
    }
  });
});
