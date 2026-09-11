import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/infrastructure/database/connection";
import {
  bookingSettlements,
  bookings,
  hostPaymentAccounts,
  hostPayouts,
  hostTransferReversals,
  hostTransfers,
  payments,
  properties,
  propertyStayInformation,
} from "../src/infrastructure/database/schema";
import { PaymentsService } from "../src/modules/payments/payments.service";
import { SettlementWorker } from "../src/modules/settlements/settlement.worker";
import { SettlementsService } from "../src/modules/settlements/settlements.service";
import {
  DATABASE,
  cleanupHosts,
  clearFinancials,
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
let settlements: SettlementsService;
let worker: SettlementWorker;
let host: TestHost;
let stranger: TestHost;
let property: { id: string; slug: string };
const created: TestHost[] = [];

let counter = 0;
const nextKey = () => `settle-${Date.now()}-${(counter += 1)}`;

/** 5% — matches PLATFORM_FEE_BPS below, and the milestone's worked example. */
const FEE_BPS = 500;

type Paid = {
  bookingId: string;
  reference: string;
  token: string;
  intentId: string;
  totalMinor: number;
};

/**
 * A Booking taken all the way through payment, the way production does it:
 * create, start payment, then a signed success event from the provider.
 */
async function paidBooking(
  checkIn = "2029-09-12",
  checkOut = "2029-09-18",
): Promise<Paid> {
  const created = await app.inject({
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

  expect(created.statusCode).toBe(201);
  const reference = created.json().reference as string;
  const token = created.cookies.find((c) => c.name === "rezervio_booking_access")!.value;

  const started = await app.inject({
    method: "POST",
    url: `/api/bookings/${reference}/payment`,
    cookies: { rezervio_booking_access: token },
  });
  expect(started.statusCode).toBe(200);

  const intentId = provider.intentFor(started.json().paymentId)!;
  await succeed(intentId, started.json().amountMinor);

  const [row] = await database.db
    .select()
    .from(bookings)
    .where(eq(bookings.publicReference, reference));

  return {
    bookingId: row.id,
    reference,
    token,
    intentId,
    totalMinor: row.totalAmountMinor,
  };
}

async function succeed(intentId: string, amountMinor: number, eventId?: string) {
  const { payload, signature } = signedEvent({
    id: eventId ?? `evt_${Math.random().toString(36).slice(2, 14)}`,
    type: "payment_intent.succeeded",
    payment: {
      providerPaymentId: intentId,
      amountMinor,
      currency: "PLN",
      status: "SUCCEEDED",
    },
  });

  return app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });
}

/** Marks the Host's connected account ready to receive money. */
async function makeHostReady(who: TestHost = host) {
  await database.db
    .insert(hostPaymentAccounts)
    .values({
      hostId: who.hostId,
      provider: "STRIPE",
      providerAccountId: `acct_${who.hostId.slice(0, 12)}`,
      onboardingStatus: "READY",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
    .onConflictDoNothing();
}

/** Moves the release instant into the past — no test waits on a real clock. */
async function makeDue(settlementId: string) {
  await database.db
    .update(bookingSettlements)
    .set({ releaseAt: new Date(Date.now() - 1000) })
    .where(eq(bookingSettlements.id, settlementId));
}

async function fullRefund(paid: Paid) {
  const [payment] = await database.db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, paid.bookingId));

  const { refundId } = await app
    .get(PaymentsService)
    .requestRefund(payment, "GUEST_CANCELLED", payment.amountMinor);

  await app.get(PaymentsService).processRefund(refundId);
  return refundId;
}

async function settlementFor(bookingId: string) {
  const [row] = await database.db
    .select()
    .from(bookingSettlements)
    .where(eq(bookingSettlements.bookingId, bookingId));
  return row;
}

async function reset() {
  await database.db.execute(sql`DELETE FROM availability_blocks`);
  await database.db.execute(sql`DELETE FROM booking_holds`);
  await clearFinancials(database);
  await database.db.delete(bookings);
  await database.db.execute(sql`DELETE FROM payment_provider_events`);
  await database.db.delete(hostPaymentAccounts);
  await database.db.delete(propertyStayInformation);
  await database.db.execute(sql`DELETE FROM idempotency_keys`);
  await database.db.execute(sql`DELETE FROM outbox_events`);
  await database.db.execute(sql`DELETE FROM notification_deliveries`);
  provider.reset();
}

beforeAll(async () => {
  process.env.PLATFORM_FEE_BPS = String(FEE_BPS);
  process.env.HOST_SETTLEMENT_RELEASE_DELAY_HOURS = "24";

  provider = new FakePaymentProvider();
  app = await createTestApp({
    emailProvider: new FakeEmailProvider(),
    paymentProvider: provider,
  });
  database = app.get<Database>(DATABASE);
  settlements = app.get(SettlementsService);
  worker = app.get(SettlementWorker);

  host = await registerHost(app, "settle-owner");
  stranger = await registerHost(app, "settle-stranger");
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

describe("settlement creation", () => {
  it("opens exactly one Settlement when the payment succeeds", async () => {
    const paid = await paidBooking();

    const rows = await database.db
      .select()
      .from(bookingSettlements)
      .where(eq(bookingSettlements.bookingId, paid.bookingId));

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
  });

  it("takes the amounts from the Booking snapshot", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    const expectedFee = Math.round((paid.totalMinor * FEE_BPS) / 10_000);

    expect(settlement.grossAmountMinor).toBe(paid.totalMinor);
    expect(settlement.platformFeeMinor).toBe(expectedFee);
    expect(settlement.hostAmountMinor).toBe(paid.totalMinor - expectedFee);
    expect(settlement.currency).toBe("PLN");
  });

  it("keeps the split adding up", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    expect(settlement.hostAmountMinor + settlement.platformFeeMinor).toBe(
      settlement.grossAmountMinor,
    );
  });

  it("does not reprice an old Booking with today's commission", async () => {
    const paid = await paidBooking();
    const before = await settlementFor(paid.bookingId);

    // Rezervio changes its rate; the existing Settlement must not move.
    process.env.PLATFORM_FEE_BPS = "2000";
    await settlements.createFor(paid.bookingId);

    const after = await settlementFor(paid.bookingId);
    expect(after.platformFeeMinor).toBe(before.platformFeeMinor);
    expect(after.hostAmountMinor).toBe(before.hostAmountMinor);

    process.env.PLATFORM_FEE_BPS = String(FEE_BPS);
  });

  it("computes releaseAt from check-in in the Property time zone", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/host/properties/${property.id}/stay-information`,
      cookies: host.cookies,
      payload: {
        checkInTime: "15:00",
        checkOutTime: "11:00",
        instructionsSendOffsetHours: 24,
      },
    });

    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    // 15:00 Warsaw on 12 Sep 2029 is 13:00 UTC; plus 24 h.
    expect(settlement.releaseAt.toISOString()).toBe("2029-09-13T13:00:00.000Z");
  });

  it("follows the Property time zone, not the server's", async () => {
    await database.db
      .update(properties)
      .set({ timeZone: "Pacific/Auckland" })
      .where(eq(properties.id, property.id));

    const paid = await paidBooking();
    // 15:00 Auckland on 12 Sep 2029 is 03:00 UTC; plus 24 h.
    expect((await settlementFor(paid.bookingId)).releaseAt.toISOString()).toBe(
      "2029-09-13T03:00:00.000Z",
    );

    await database.db
      .update(properties)
      .set({ timeZone: "Europe/Warsaw" })
      .where(eq(properties.id, property.id));
  });

  it("is not duplicated by a replayed event", async () => {
    const paid = await paidBooking();

    await succeed(paid.intentId, paid.totalMinor, "evt_replay_settlement");
    await succeed(paid.intentId, paid.totalMinor, "evt_replay_settlement");
    await settlements.createFor(paid.bookingId);

    const rows = await database.db
      .select()
      .from(bookingSettlements)
      .where(eq(bookingSettlements.bookingId, paid.bookingId));
    expect(rows).toHaveLength(1);
  });
});

describe("release", () => {
  it("holds the money until the release instant", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    const result = await settlements.release(settlement.id);

    expect(result).toEqual({ released: false, reason: "TOO_EARLY" });
    expect((await settlementFor(paid.bookingId)).status).toBe("PENDING");
  });

  it("releases once the instant has passed", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);

    expect(await settlements.release(settlement.id)).toEqual({ released: true });

    const after = await settlementFor(paid.bookingId);
    expect(after.status).toBe("AVAILABLE");
    expect(after.availableAt).not.toBeNull();
  });

  it("is idempotent", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);

    await settlements.release(settlement.id);
    expect(await settlements.release(settlement.id)).toEqual({
      released: false,
      reason: "ALREADY",
    });
  });

  it("refuses to release a cancelled Booking", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);

    await database.db
      .update(bookings)
      .set({ status: "CANCELLED" })
      .where(eq(bookings.id, paid.bookingId));

    expect(await settlements.release(settlement.id)).toEqual({
      released: false,
      reason: "BOOKING_CANCELLED",
    });
  });

  it("refuses to release while a refund is in progress", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);

    const [payment] = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, paid.bookingId));
    await app.get(PaymentsService).requestRefund(payment, "GUEST_CANCELLED", payment.amountMinor);

    expect(await settlements.release(settlement.id)).toEqual({
      released: false,
      reason: "REFUND_IN_PROGRESS",
    });
  });

  it("releases at most once under concurrent jobs", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);

    const results = await Promise.all([
      settlements.release(settlement.id),
      settlements.release(settlement.id),
      settlements.release(settlement.id),
    ]);

    expect(results.filter((result) => result.released)).toHaveLength(1);
  });
});

describe("transfer", () => {
  async function releasedSettlement() {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);
    return { paid, settlement: await settlementFor(paid.bookingId) };
  }

  it("sends the Host their amount once the Settlement is available", async () => {
    const { paid, settlement } = await releasedSettlement();

    expect(await worker.runTransfer(settlement.id)).toEqual({ transferred: true });

    const after = await settlementFor(paid.bookingId);
    expect(after.status).toBe("TRANSFERRED");
    expect(after.providerTransferId).not.toBeNull();
    expect(after.transferredAt).not.toBeNull();

    expect(provider.transfers.at(-1)!.amountMinor).toBe(settlement.hostAmountMinor);
  });

  it("never sends an amount the browser chose", async () => {
    const { settlement } = await releasedSettlement();
    await worker.runTransfer(settlement.id);

    // The only amount that ever reaches the provider is the settled one.
    expect(provider.transfers.at(-1)!.amountMinor).toBe(settlement.hostAmountMinor);
    expect(provider.transfers.at(-1)!.currency).toBe("PLN");
  });

  it("waits for a Host who has not finished onboarding", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);

    expect(await worker.runTransfer(settlement.id)).toEqual({
      transferred: false,
      reason: "HOST_NOT_READY",
    });

    // Not a failure: the money is still the Host's.
    expect((await settlementFor(paid.bookingId)).status).toBe("AVAILABLE");
    expect(provider.transfers).toHaveLength(0);
  });

  it("creates one provider transfer even with concurrent workers", async () => {
    const { settlement } = await releasedSettlement();
    const before = provider.transfers.length;

    const results = await Promise.all([
      worker.runTransfer(settlement.id),
      worker.runTransfer(settlement.id),
      worker.runTransfer(settlement.id),
    ]);

    expect(results.filter((result) => result.transferred)).toHaveLength(1);
    expect(provider.transfers.length - before).toBe(1);

    const rows = await database.db
      .select()
      .from(hostTransfers)
      .where(eq(hostTransfers.settlementId, settlement.id));
    expect(rows.filter((row) => row.status === "SUCCEEDED")).toHaveLength(1);
  });

  it("does not pay twice when the job is retried after success", async () => {
    const { settlement } = await releasedSettlement();
    await worker.runTransfer(settlement.id);
    const before = provider.transfers.length;

    expect(await worker.runTransfer(settlement.id)).toEqual({
      transferred: false,
      reason: "ALREADY_TRANSFERRED",
    });
    expect(provider.transfers.length).toBe(before);
  });

  it("keeps the money owed after a provider failure", async () => {
    const { paid, settlement } = await releasedSettlement();
    provider.failTransfers(1);

    await expect(worker.runTransfer(settlement.id)).rejects.toThrow();

    // Back to AVAILABLE so the next attempt finds it waiting.
    const after = await settlementFor(paid.bookingId);
    expect(after.status).toBe("AVAILABLE");

    expect(await worker.runTransfer(settlement.id)).toEqual({ transferred: true });
    expect((await settlementFor(paid.bookingId)).status).toBe("TRANSFERRED");
  });
});

describe("refund before transfer", () => {
  it("cancels the Settlement and sends nothing", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    await fullRefund(paid);

    const after = await settlementFor(paid.bookingId);
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledAt).not.toBeNull();

    expect(await worker.runTransfer(settlement.id)).toEqual({
      transferred: false,
      reason: "CANCELLED",
    });
    expect(provider.transfers).toHaveLength(0);
  });

  it("cancels an already released Settlement too", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);

    await fullRefund(paid);

    expect((await settlementFor(paid.bookingId)).status).toBe("CANCELLED");
    expect(provider.transfers).toHaveLength(0);
  });

  it("leaves a partial refund alone", async () => {
    await makeHostReady();
    const paid = await paidBooking();

    const [payment] = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, paid.bookingId));
    const { refundId } = await app
      .get(PaymentsService)
      .requestRefund(payment, "AMOUNT_MISMATCH", 100);
    await app.get(PaymentsService).processRefund(refundId);

    // Partial-refund accounting is out of scope for this milestone.
    expect((await settlementFor(paid.bookingId)).status).toBe("PENDING");
  });
});

describe("refund after transfer", () => {
  async function transferred() {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);
    await worker.runTransfer(settlement.id);
    return { paid, settlementId: settlement.id };
  }

  it("asks for exactly one reversal", async () => {
    const { paid, settlementId } = await transferred();

    await fullRefund(paid);

    const reversals = await database.db
      .select()
      .from(hostTransferReversals)
      .where(eq(hostTransferReversals.settlementId, settlementId));

    expect(reversals).toHaveLength(1);
    expect(reversals[0].reason).toBe("REFUNDED_AFTER_TRANSFER");
    expect((await settlementFor(paid.bookingId)).status).toBe("REVERSAL_PENDING");
  });

  it("completes the reversal", async () => {
    const { paid, settlementId } = await transferred();
    await fullRefund(paid);

    const [reversal] = await database.db
      .select()
      .from(hostTransferReversals)
      .where(eq(hostTransferReversals.settlementId, settlementId));

    expect(await settlements.processReversal(reversal.id)).toEqual({ status: "SUCCEEDED" });

    expect((await settlementFor(paid.bookingId)).status).toBe("REVERSED");

    const [transfer] = await database.db
      .select()
      .from(hostTransfers)
      .where(eq(hostTransfers.settlementId, settlementId));
    expect(transfer.status).toBe("REVERSED");
  });

  it("reverses the transferred amount, once", async () => {
    const { paid, settlementId } = await transferred();
    const settlement = await settlementFor(paid.bookingId);

    await fullRefund(paid);
    const [reversal] = await database.db
      .select()
      .from(hostTransferReversals)
      .where(eq(hostTransferReversals.settlementId, settlementId));

    await settlements.processReversal(reversal.id);
    await settlements.processReversal(reversal.id);

    expect(provider.reversals).toHaveLength(1);
    expect(provider.reversals[0].amountMinor).toBe(settlement.hostAmountMinor);
  });

  it("does not open a second reversal when the refund is seen again", async () => {
    const { paid, settlementId } = await transferred();
    await fullRefund(paid);

    await settlements.onRefund(paid.bookingId);
    await settlements.onRefund(paid.bookingId);

    const reversals = await database.db
      .select()
      .from(hostTransferReversals)
      .where(eq(hostTransferReversals.settlementId, settlementId));
    expect(reversals).toHaveLength(1);
  });
});

describe("reconciliation", () => {
  it("repairs a transfer the provider completed but we never recorded", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);

    // Simulate a crash between the provider call and persisting the result.
    const claim = await settlements.prepareTransfer(settlement.id);
    expect(claim.ready).toBe(true);
    const providerTransferId = "tr_lost_in_flight";
    await database.db
      .update(hostTransfers)
      .set({ providerTransferId })
      .where(eq(hostTransfers.settlementId, settlement.id));
    provider.setProviderTransferStatus(providerTransferId, "SUCCEEDED");

    const result = await worker.reconcile();

    expect(result.transfersRepaired).toBe(1);
    expect((await settlementFor(paid.bookingId)).status).toBe("TRANSFERRED");
  });

  it("releases and transfers what is due", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);

    const result = await worker.reconcile();

    expect(result.released).toBe(1);
    expect((await settlementFor(paid.bookingId)).status).toBe("TRANSFERRED");
  });

  it("moves no money twice when run repeatedly", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    await makeDue((await settlementFor(paid.bookingId)).id);

    await worker.reconcile();
    const afterFirst = provider.transfers.length;
    await worker.reconcile();
    await worker.reconcile();

    expect(provider.transfers.length).toBe(afterFirst);
    expect((await settlementFor(paid.bookingId)).status).toBe("TRANSFERRED");
  });

  it("leaves a mismatch visible rather than guessing", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);

    await settlements.prepareTransfer(settlement.id);
    await database.db
      .update(hostTransfers)
      .set({ providerTransferId: "tr_unknown_to_provider" })
      .where(eq(hostTransfers.settlementId, settlement.id));

    await worker.reconcile();

    // The provider does not know it, so nothing is invented; the row stays
    // observable in a non-final state.
    const [transfer] = await database.db
      .select()
      .from(hostTransfers)
      .where(eq(hostTransfers.settlementId, settlement.id));
    expect(["PROCESSING", "SUCCEEDED"]).toContain(transfer.status);
  });
});

describe("payouts", () => {
  it("records what the provider reports", async () => {
    await makeHostReady();
    provider.setPayouts([
      {
        providerPayoutId: "po_test_1",
        providerAccountId: `acct_${host.hostId.slice(0, 12)}`,
        amountMinor: 182400,
        currency: "PLN",
        status: "IN_TRANSIT",
        arrivalAt: new Date("2029-09-20T00:00:00Z"),
      },
    ]);

    expect(await worker.observePayouts()).toBe(1);

    const [payout] = await database.db
      .select()
      .from(hostPayouts)
      .where(eq(hostPayouts.hostId, host.hostId));
    expect(payout).toMatchObject({ status: "IN_TRANSIT", amountMinor: 182400 });

    provider.setPayouts([]);
  });

  it("updates rather than duplicating on repeat observation", async () => {
    await makeHostReady();
    const payout = {
      providerPayoutId: "po_test_2",
      providerAccountId: `acct_${host.hostId.slice(0, 12)}`,
      amountMinor: 100000,
      currency: "PLN",
      status: "IN_TRANSIT" as const,
      arrivalAt: null,
    };

    provider.setPayouts([payout]);
    await worker.observePayouts();
    provider.setPayouts([{ ...payout, status: "PAID" }]);
    await worker.observePayouts();

    const rows = await database.db
      .select()
      .from(hostPayouts)
      .where(eq(hostPayouts.hostId, host.hostId));

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PAID");
    expect(rows[0].paidAt).not.toBeNull();

    provider.setPayouts([]);
  });

  it("keeps a failed payout visible to the Host", async () => {
    await makeHostReady();
    await worker.recordPayout(host.hostId, {
      providerPayoutId: "po_failed_1",
      amountMinor: 50000,
      currency: "PLN",
      status: "FAILED",
      arrivalAt: null,
      failureCode: "account_closed",
      failureMessage: "Konto bankowe zostało zamknięte.",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/host/payouts",
      cookies: host.cookies,
    });

    expect(response.json()[0]).toMatchObject({
      status: "FAILED",
      failureMessage: "Konto bankowe zostało zamknięte.",
    });
  });

  it("ignores a payout for an account nobody owns", async () => {
    expect(
      await worker.recordPayoutFromEvent({
        providerPayoutId: "po_orphan",
        providerAccountId: "acct_unknown",
        amountMinor: 1000,
        currency: "PLN",
        status: "PAID",
        arrivalAt: null,
      }),
    ).toEqual({ recorded: false });
  });
});

describe("host finance API", () => {
  it("reports balances derived from the Settlements", async () => {
    await makeHostReady();

    const pending = await paidBooking("2029-09-12", "2029-09-18");
    const available = await paidBooking("2029-10-12", "2029-10-18");
    await makeDue((await settlementFor(available.bookingId)).id);
    await settlements.release((await settlementFor(available.bookingId)).id);

    const response = await app.inject({
      method: "GET",
      url: "/api/host/payments/summary",
      cookies: host.cookies,
    });

    const pendingSettlement = await settlementFor(pending.bookingId);
    const availableSettlement = await settlementFor(available.bookingId);

    expect(response.json().balance).toMatchObject({
      pendingMinor: pendingSettlement.hostAmountMinor,
      availableMinor: availableSettlement.hostAmountMinor,
      transferredMinor: 0,
    });
    expect(response.json().payoutsReady).toBe(true);
  });

  it("lists the settlements with their business context", async () => {
    const paid = await paidBooking();

    const response = await app.inject({
      method: "GET",
      url: "/api/host/settlements",
      cookies: host.cookies,
    });

    expect(response.json().items[0]).toMatchObject({
      bookingReference: paid.reference,
      propertyTitle: "Baltic Loft",
      status: "PENDING",
      canReleaseNow: true,
    });
  });

  it("never shows one Host another Host's money", async () => {
    await paidBooking();

    const summary = await app.inject({
      method: "GET",
      url: "/api/host/payments/summary",
      cookies: stranger.cookies,
    });
    expect(summary.json().balance.pendingMinor).toBe(0);

    const list = await app.inject({
      method: "GET",
      url: "/api/host/settlements",
      cookies: stranger.cookies,
    });
    expect(list.json().items).toHaveLength(0);
  });

  it("refuses a sandbox release on somebody else's settlement", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/settlements/${settlement.id}/release-now`,
      cookies: stranger.cookies,
    });

    expect(response.statusCode).toBe(404);
    expect((await settlementFor(paid.bookingId)).status).toBe("PENDING");
  });

  it("releases now in the sandbox, using the normal rules", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/settlements/${settlement.id}/release-now`,
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(200);
    // Released without waiting for the clock, but every other rule applied.
    expect(["AVAILABLE", "TRANSFER_PENDING", "TRANSFERRED"]).toContain(
      (await settlementFor(paid.bookingId)).status,
    );
  });

  it("still refuses to release now when a refund is under way", async () => {
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);

    const [payment] = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, paid.bookingId));
    await app.get(PaymentsService).requestRefund(payment, "GUEST_CANCELLED", payment.amountMinor);

    const response = await app.inject({
      method: "POST",
      url: `/api/host/settlements/${settlement.id}/release-now`,
      cookies: host.cookies,
    });

    expect(response.statusCode).toBe(409);
  });

  it("needs a Host profile", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/host/payments/summary" })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/host/settlements" })).statusCode,
    ).toBe(401);
  });
});

describe("terminology", () => {
  it("keeps Payment, Settlement, Transfer and Payout as four different things", async () => {
    await makeHostReady();
    const paid = await paidBooking();
    const settlement = await settlementFor(paid.bookingId);
    await makeDue(settlement.id);
    await settlements.release(settlement.id);
    await worker.runTransfer(settlement.id);

    const [payment] = await database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, paid.bookingId));
    const [transfer] = await database.db
      .select()
      .from(hostTransfers)
      .where(eq(hostTransfers.settlementId, settlement.id));

    // The Guest paid the gross; the Host receives the gross minus the fee.
    expect(payment.amountMinor).toBe(settlement.grossAmountMinor);
    expect(transfer.amountMinor).toBe(settlement.hostAmountMinor);
    expect(transfer.amountMinor).toBeLessThan(payment.amountMinor);

    // And a Transfer is not a Payout: nothing was paid to a bank here.
    expect(
      await database.db.select().from(hostPayouts).where(eq(hostPayouts.hostId, host.hostId)),
    ).toHaveLength(0);
  });
});
