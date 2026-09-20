import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { Queue } from "bullmq";

import { DATABASE } from "../../infrastructure/database/database.module";
import {
  REFUND_QUEUE,
  type PaymentRefundJob,
} from "../../infrastructure/queue/queue.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  bookingHolds,
  bookings,
  payments,
  paymentProviderEvents,
  refunds,
  type BookingRow,
  type PaymentRow,
  type PaymentStatus,
  type RefundReason,
} from "../../infrastructure/database/schema";
import {
  acquirePropertyLock,
  rangeLiteral,
} from "../availability/availability.service";
import { BookingsService } from "../bookings/bookings.service";
import { SettlementWorker } from "../settlements/settlement.worker";
import { SettlementsService } from "../settlements/settlements.service";
import { StayLifecycleWorker } from "../stay/stay-lifecycle.worker";
import { HostPaymentsService } from "./host-payments.service";
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentProvider,
  type ProviderEvent,
  type ProviderPaymentState,
} from "./domain/payment-provider";

/** The Stay is no longer held, so there is nothing left to pay for. */
export class BookingHoldExpiredError extends ConflictException {
  constructor() {
    super({
      code: "BOOKING_HOLD_EXPIRED",
      message: "Termin nie jest już zablokowany. Sprawdź ponownie dostępność.",
    });
  }
}

export class BookingNotPayableError extends ConflictException {
  constructor(message = "Ta rezerwacja nie oczekuje na płatność.") {
    super({ code: "BOOKING_NOT_PAYABLE", message });
  }
}

export type StartedPayment = {
  paymentId: string;
  clientSecret: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  /** Mirrors the hold, so the form can show how long is left. */
  expiresAt: Date | null;
};

/** Which provider outcomes are still open, i.e. reusable by a retry. */
const OPEN: PaymentStatus[] = ["CREATED", "PROCESSING", "REQUIRES_ACTION"];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly bookings: BookingsService,
    private readonly hostAccounts: HostPaymentsService,
    private readonly stayLifecycle: StayLifecycleWorker,
    private readonly settlements: SettlementsService,
    private readonly settlementJobs: SettlementWorker,
    @Inject(REFUND_QUEUE) private readonly refundQueue: Queue<PaymentRefundJob>,
    private readonly config: ConfigService,
  ) {}

  /** Basis points Rezervio keeps. Zero in development until the rate is decided. */
  private get platformFeeBps(): number {
    return Number(this.config.get("PLATFORM_FEE_BPS") ?? 0);
  }

  private platformFee(amountMinor: number): number {
    return Math.round((amountMinor * this.platformFeeBps) / 10_000);
  }

  // ---------------------------------------------------------------- payment

  /**
   * Starts — or resumes — paying for a Booking.
   *
   * Split deliberately into read, provider call, short write: a Stripe request
   * inside an open transaction would hold a row lock for the length of a
   * network round trip, and a timeout would roll back a PaymentIntent that
   * really exists (milestone 08 §12, §41).
   */
  async startPayment(bookingId: string): Promise<StartedPayment> {
    /*
     * First, find out what the provider already thinks.
     *
     * Without this the panel would happily resume a PaymentIntent that has
     * *already succeeded* — Stripe replays the original response for a
     * repeated idempotency key, so the browser gets a client secret it can no
     * longer confirm, and the Guest is told the payment failed after their
     * card was charged. Asking first is what makes this page correct when the
     * webhook is late, or never arrives at all (milestone 08 §16, §19).
     */
    await this.reconcile(bookingId);

    const { booking, hold } = await this.loadPayable(bookingId);

    const existing = await this.openPaymentFor(booking.id);

    // A Payment that already reached the provider is resumed rather than
    // replaced; Stripe returns the same intent for the same idempotency key.
    const payment = existing ?? (await this.createPaymentRow(booking));

    const provider = await this.provider.createPayment({
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      metadata: {
        bookingId: booking.id,
        paymentId: payment.id,
        bookingReference: booking.publicReference,
      },
    });

    await this.database.db
      .update(payments)
      .set({
        providerPaymentId: provider.providerPaymentId,
        // The provider's view of an in-flight intent, mapped to our states.
        status: provider.status === "SUCCEEDED" ? "PROCESSING" : payment.status,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    if (!existing) {
      await this.bookings.recordPaymentEvent(booking.id, "PAYMENT_STARTED", {
        paymentId: payment.id,
      });
    }

    this.logger.log({
      event: "payment.started",
      paymentId: payment.id,
      bookingId: booking.id,
      resumed: existing !== null,
    });

    return {
      paymentId: payment.id,
      // Never logged and never persisted: it authorises confirming the intent.
      clientSecret: provider.clientSecret,
      status: payment.status as PaymentStatus,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      expiresAt: hold.expiresAt,
    };
  }

  /** The Booking must be awaiting payment and still holding its dates (§15). */
  private async loadPayable(
    bookingId: string,
  ): Promise<{ booking: BookingRow; hold: { id: string; expiresAt: Date } }> {
    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");

    if (booking.status === "CONFIRMED") {
      throw new BookingNotPayableError("Ta rezerwacja jest już opłacona.");
    }
    if (booking.status !== "PENDING_PAYMENT") {
      if (booking.status === "EXPIRED") throw new BookingHoldExpiredError();
      throw new BookingNotPayableError();
    }

    const [hold] = await this.database.db
      .select({ id: bookingHolds.id, expiresAt: bookingHolds.expiresAt })
      .from(bookingHolds)
      .where(
        and(eq(bookingHolds.bookingId, booking.id), eq(bookingHolds.status, "ACTIVE")),
      )
      .limit(1);

    if (!hold || hold.expiresAt.getTime() <= Date.now()) {
      throw new BookingHoldExpiredError();
    }

    return { booking, hold };
  }

  private async openPaymentFor(bookingId: string): Promise<PaymentRow | null> {
    const [row] = await this.database.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), inArray(payments.status, OPEN)))
      .limit(1);

    return row ?? null;
  }

  /**
   * The amount comes from the Booking snapshot and nowhere else. A client that
   * proposes an amount is proposing a discount (milestone 08 §9).
   */
  private async createPaymentRow(booking: BookingRow): Promise<PaymentRow> {
    try {
      const [row] = await this.database.db
        .insert(payments)
        .values({
          bookingId: booking.id,
          provider: this.provider.name,
          amountMinor: booking.totalAmountMinor,
          currency: booking.currency,
          platformFeeAmountMinor: this.platformFee(booking.totalAmountMinor),
        })
        .returning();

      return row;
    } catch (error) {
      // Lost a race against a concurrent start; the partial unique index means
      // the winner's row is the one to use.
      const open = await this.openPaymentFor(booking.id);
      if (open) return open;
      throw error;
    }
  }

  // ------------------------------------------------------------- reconcile

  /**
   * Asks the provider what really happened, and applies it.
   *
   * The webhook remains the primary path and the only one with a signature,
   * but it is a *push*: it can be minutes late, it can be lost, and against a
   * developer machine with no public address it never arrives at all. A hold
   * lives ten minutes, so "wait for the push" means a charged card and an
   * expired Booking.
   *
   * This is the pull. It is not a second, weaker source of truth — it reads
   * the same provider and feeds the same state machine `handleWebhook` does,
   * so a Booking confirmed here is confirmed on exactly the evidence a
   * Booking confirmed there is. What it never does is believe the browser:
   * the browser can ask us to look, and nothing more (milestone 08 §4, §16).
   */
  async reconcile(bookingId: string): Promise<void> {
    const open = await this.database.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.bookingId, bookingId), inArray(payments.status, OPEN)),
      );

    for (const payment of open) {
      if (!payment.providerPaymentId) continue;

      let state: ProviderPaymentState | null;
      try {
        state = await this.provider.retrievePayment(payment.providerPaymentId);
      } catch (error) {
        /*
         * A provider that cannot be reached must not take the page down with
         * it: the Booking is still payable, the hold is still running, and the
         * webhook may yet land. Logged and skipped.
         */
        this.logger.warn({
          event: "payment.reconcile_failed",
          paymentId: payment.id,
          code: error instanceof PaymentProviderError ? error.code : null,
        });
        continue;
      }

      if (!state) continue;

      await this.applyProviderState(payment, state);
    }
  }

  /**
   * The one place a provider outcome becomes a domain fact.
   *
   * Shared by the webhook and by `reconcile`, so the two cannot drift: a
   * success confirms the Booking through the same transaction either way, and
   * a decline leaves the Booking payable either way.
   */
  private async applyProviderState(
    payment: PaymentRow,
    state: ProviderPaymentState,
  ): Promise<void> {
    if (state.status === "SUCCEEDED") {
      await this.applySucceeded(payment, state);
      return;
    }

    if (state.status === "FAILED") {
      await this.applyFailed(payment, state);
      return;
    }

    if (state.status === "CANCELLED") {
      await this.markTerminal(payment.id, "CANCELLED", { cancelledAt: new Date() });
    }

    // PROCESSING and REQUIRES_ACTION are not outcomes — the Guest is still
    // paying, and the Payment stays open so the panel can carry on.
  }

  /**
   * Reconciles, then reports where the Booking stands.
   *
   * What the browser gets back is read from our own database *after* the
   * provider has been consulted — never from anything the browser sent.
   */
  async syncPayment(
    bookingId: string,
  ): Promise<{ bookingStatus: string; paymentStatus: string | null }> {
    await this.reconcile(bookingId);

    const [booking] = await this.database.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");

    const [payment] = await this.database.db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    return { bookingStatus: booking.status, paymentStatus: payment?.status ?? null };
  }

  // ---------------------------------------------------------------- webhook

  /**
   * The only path by which money becomes real.
   *
   * The browser reporting success proves nothing: anybody can call our API.
   * A signed provider event, verified server-side, is the evidence
   * (milestone 08 §4).
   */
  async handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    const event = this.provider.verifyEvent(rawBody, signature);

    const claimed = await this.claimEvent(event);
    if (!claimed) {
      this.logger.log({ event: "payment.webhook.duplicate", type: event.type });
      return { received: true, duplicate: true };
    }

    await this.dispatch(event);

    await this.database.db
      .update(paymentProviderEvents)
      .set({ processedAt: new Date() })
      .where(
        and(
          eq(paymentProviderEvents.provider, this.provider.name),
          eq(paymentProviderEvents.providerEventId, event.id),
        ),
      );

    return { received: true, duplicate: false };
  }

  /**
   * Claims an event exactly once.
   *
   * Providers deliver at least once and replay on demand, so the unique key on
   * (provider, provider_event_id) is what turns repeated delivery into a
   * single domain effect (milestone 08 §19).
   */
  private async claimEvent(event: ProviderEvent): Promise<boolean> {
    const inserted = await this.database.db
      .insert(paymentProviderEvents)
      .values({
        provider: this.provider.name,
        providerEventId: event.id,
        eventType: event.type,
      })
      .onConflictDoNothing()
      .returning({ id: paymentProviderEvents.id });

    return inserted.length > 0;
  }

  private async dispatch(event: ProviderEvent): Promise<void> {
    if (event.account) {
      await this.hostAccounts.applyAccount(event.account);
      return;
    }

    if (event.payout) {
      // Payouts belong to the Host's connected account; we observe them so a
      // Host can see where their money is (milestone 10 §17, §23).
      await this.settlementJobs.recordPayoutFromEvent(event.payout);
      return;
    }

    if (event.transfer) {
      await this.settlements.applyTransferEvent(event.transfer);
      return;
    }

    if (!event.payment) return;

    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.providerPaymentId, event.payment.providerPaymentId))
      .limit(1);

    if (!payment) {
      // A PaymentIntent Rezervio never created, or one from another
      // environment sharing the same sandbox account. Nothing to do.
      this.logger.warn({ event: "payment.webhook.unknown_payment", type: event.type });
      return;
    }

    await this.applyProviderState(payment, event.payment);
  }

  /**
   * The heart of the milestone.
   *
   * Everything from re-reading the Booking to swapping the hold block for a
   * Booking block happens in one transaction under the Property advisory lock.
   * A commit between removing the hold and inserting the Booking block would
   * open a window in which the Stay looks free and a second Guest could take
   * it (milestone 08 §21).
   */
  private async applySucceeded(
    payment: PaymentRow,
    provider: { amountMinor: number; currency: string },
  ): Promise<void> {
    // Never trust the amount in the event over our own snapshot. A mismatch
    // means something is wrong upstream; confirming would be worse than
    // refunding (milestone 08 §48).
    if (
      provider.amountMinor !== payment.amountMinor ||
      provider.currency !== payment.currency
    ) {
      this.logger.error({
        event: "payment.amount_mismatch",
        paymentId: payment.id,
        expectedMinor: payment.amountMinor,
        receivedMinor: provider.amountMinor,
      });

      await this.markTerminal(payment.id, "SUCCEEDED", { succeededAt: new Date() });
      await this.requestRefund(payment, "AMOUNT_MISMATCH", provider.amountMinor);
      return;
    }

    const outcome = await this.database.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .limit(1);

      if (!booking) return { kind: "unknown" as const };

      // First statement that matters: everything below re-reads under the lock.
      await acquirePropertyLock(tx, booking.propertyId);

      const [fresh] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .limit(1);

      const [hold] = await tx
        .select()
        .from(bookingHolds)
        .where(eq(bookingHolds.bookingId, payment.bookingId))
        .limit(1);

      const [current] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, payment.id))
        .limit(1);

      // Already done — a replayed event, or a reconciliation that got here
      // first. Not an error.
      if (fresh.status === "CONFIRMED") return { kind: "already" as const };

      const holdAlive =
        hold?.status === "ACTIVE" && hold.expiresAt.getTime() > Date.now();

      if (fresh.status !== "PENDING_PAYMENT" || !holdAlive) {
        // The hold lapsed first. The money is real, the Stay is not: keep the
        // Booking expired and send the money back (milestone 08 §23).
        if (current.status !== "SUCCEEDED") {
          await tx
            .update(payments)
            .set({ status: "SUCCEEDED", succeededAt: new Date(), updatedAt: new Date() })
            .where(eq(payments.id, payment.id));
        }

        if (fresh.status === "PENDING_PAYMENT") {
          await tx
            .update(bookings)
            .set({
              status: "EXPIRED",
              statusReason: "PAYMENT_AFTER_HOLD_EXPIRY",
              expiredAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(bookings.id, fresh.id));
        }

        await this.bookings.recordPaymentEvent(
          fresh.id,
          "PAYMENT_SUCCEEDED",
          { paymentId: payment.id },
          tx,
        );

        return { kind: "late" as const, booking: fresh };
      }

      await tx
        .update(payments)
        .set({ status: "SUCCEEDED", succeededAt: new Date(), updatedAt: new Date() })
        .where(eq(payments.id, payment.id));

      await tx
        .update(bookings)
        .set({
          status: "CONFIRMED",
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, fresh.id));

      await tx
        .update(bookingHolds)
        .set({ status: "CONVERTED" })
        .where(eq(bookingHolds.id, hold.id));

      /*
       * The conversion itself. The hold block is replaced in place rather than
       * deleted and re-inserted, so at no point in this transaction — and
       * therefore at no point visible to anyone else — are the dates unblocked.
       */
      await tx.execute(sql`
        UPDATE availability_blocks
           SET source_type = 'BOOKING',
               booking_hold_id = NULL,
               booking_id = ${fresh.id},
               updated_at = now()
         WHERE booking_hold_id = ${hold.id}
      `);

      // A hold whose block went missing (manual surgery, an old row) still
      // deserves a Booking block: the confirmed Stay must block the calendar.
      await tx.execute(sql`
        INSERT INTO availability_blocks (property_id, source_type, date_range, booking_id)
        SELECT ${fresh.propertyId}, 'BOOKING',
               ${rangeLiteral({ startDate: fresh.checkIn, endDate: fresh.checkOut })},
               ${fresh.id}
        WHERE NOT EXISTS (
          SELECT 1 FROM availability_blocks WHERE booking_id = ${fresh.id}
        )
      `);

      /*
       * The trail and the notification intent commit with the state change
       * itself. An email queued outside this transaction could describe a
       * confirmation that later rolled back (milestone 05 §42).
       */
      await this.bookings.recordPaymentEvent(
        fresh.id,
        "PAYMENT_SUCCEEDED",
        { paymentId: payment.id },
        tx,
      );
      await this.bookings.recordPaymentEvent(fresh.id, "HOLD_CONVERTED", null, tx);
      await this.bookings.recordPaymentEvent(fresh.id, "BOOKING_CONFIRMED", null, tx);
      await this.bookings.notifyBooking(fresh.id, "BOOKING_CONFIRMED", tx);

      /*
       * And connected systems are told, through the same outbox.
       *
       * The intent commits with the confirmation itself, so "the Stay is
       * confirmed but nobody outside Rezervio was told" cannot happen because
       * a process died between the commit and the enqueue. Just as important:
       * confirming a Booking never waits on a provider being reachable, and a
       * provider that refuses the push does not undo the Booking
       * (milestone 12 §14, §30).
       */
      await this.bookings.recordOutboxIntent(tx, fresh.id, "EXTERNAL_RESERVATION_PUSH");

      return { kind: "confirmed" as const, booking: fresh };
    });

    if (outcome.kind === "confirmed") {
      /*
       * The Stay can now be planned: instructions, access reveal, checkout
       * reminder and the automatic completion. Scheduled after the commit, so
       * a job can never fire against a confirmation that rolled back
       * (milestone 09 §17).
       */
      await this.stayLifecycle.scheduleFor(payment.bookingId);

      /*
       * And the money owed to the Host is now determinable. Creating the
       * Settlement here — after the commit — keeps "the Guest paid" and "the
       * Host is owed" as two separate, independently recoverable facts
       * (milestone 10 §9).
       */
      const settlement = await this.settlements.createFor(payment.bookingId);
      if (settlement) {
        await this.settlementJobs.scheduleRelease(settlement.id, settlement.releaseAt);
      }

      this.logger.log({
        event: "booking.confirmed",
        bookingId: payment.bookingId,
        paymentId: payment.id,
      });
      return;
    }

    if (outcome.kind === "late") {
      // Outside the transaction on purpose: the refund is a follow-up action,
      // and the queue must not be reached before the state it acts on commits.
      await this.requestRefund(payment, "PAYMENT_AFTER_HOLD_EXPIRY", payment.amountMinor);

      this.logger.warn({
        event: "payment.after_hold_expiry",
        bookingId: payment.bookingId,
        paymentId: payment.id,
      });
    }
  }

  private async applyFailed(
    payment: PaymentRow,
    provider: { failureCode?: string | null; failureMessage?: string | null },
  ): Promise<void> {
    // The Booking deliberately stays PENDING_PAYMENT: a declined card is not a
    // lost Stay, and the Guest may retry while the hold lives (milestone 08 §26).
    await this.database.db
      .update(payments)
      .set({
        status: "FAILED",
        failedAt: new Date(),
        failureCode: provider.failureCode ?? null,
        failureMessage: provider.failureMessage ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, OPEN)));

    await this.bookings.recordPaymentEvent(payment.bookingId, "PAYMENT_FAILED", {
      paymentId: payment.id,
    });

    this.logger.log({
      event: "payment.failed",
      paymentId: payment.id,
      bookingId: payment.bookingId,
      code: provider.failureCode ?? null,
    });
  }

  private async markTerminal(
    paymentId: string,
    status: PaymentStatus,
    fields: Partial<{ succeededAt: Date; failedAt: Date; cancelledAt: Date }>,
  ): Promise<void> {
    await this.database.db
      .update(payments)
      .set({ status, updatedAt: new Date(), ...fields })
      .where(and(eq(payments.id, paymentId), inArray(payments.status, OPEN)));
  }

  // ----------------------------------------------------------------- refund

  /**
   * Records the decision to refund. The unique index on (payment_id, reason)
   * makes this exactly-once even when two recovery paths race
   * (milestone 08 §47).
   */
  async requestRefund(
    payment: PaymentRow,
    reason: RefundReason,
    amountMinor: number,
  ): Promise<{ refundId: string; created: boolean }> {
    const inserted = await this.database.db
      .insert(refunds)
      .values({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        type: amountMinor === payment.amountMinor ? "FULL" : "PARTIAL",
        amountMinor,
        currency: payment.currency,
        reason,
      })
      .onConflictDoNothing()
      .returning({ id: refunds.id });

    if (inserted.length === 0) {
      const [existing] = await this.database.db
        .select({ id: refunds.id })
        .from(refunds)
        .where(and(eq(refunds.paymentId, payment.id), eq(refunds.reason, reason)))
        .limit(1);

      return { refundId: existing.id, created: false };
    }

    await this.database.db
      .update(payments)
      .set({ status: "REFUND_PENDING", updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "SUCCEEDED")));

    await this.bookings.recordPaymentEvent(payment.bookingId, "REFUND_REQUESTED", {
      refundId: inserted[0].id,
      reason,
    });

    // One job per Refund id, so a replayed decision cannot queue a second
    // provider call for the same row.
    await this.refundQueue.add(
      "refund",
      { refundId: inserted[0].id },
      { jobId: `payment-refund-${inserted[0].id}` },
    );

    this.logger.log({
      event: "refund.requested",
      refundId: inserted[0].id,
      paymentId: payment.id,
      reason,
    });

    return { refundId: inserted[0].id, created: true };
  }

  /**
   * Carries out a recorded Refund against the provider.
   *
   * Idempotent on both sides: a Refund already SUCCEEDED is a no-op here, and
   * the provider call carries a stable idempotency key derived from the Refund
   * id (milestone 08 §25).
   */
  async processRefund(refundId: string): Promise<{ status: string }> {
    const [refund] = await this.database.db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);

    if (!refund) throw new NotFoundException("Nie znaleziono zwrotu.");
    if (refund.status === "SUCCEEDED") return { status: "SUCCEEDED" };

    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.id, refund.paymentId))
      .limit(1);

    if (!payment.providerPaymentId) {
      // Nothing was ever charged, so nothing can be sent back.
      await this.database.db
        .update(refunds)
        .set({
          status: "FAILED",
          failedAt: new Date(),
          failureCode: "NO_PROVIDER_PAYMENT",
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));

      return { status: "FAILED" };
    }

    await this.database.db
      .update(refunds)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(refunds.id, refund.id));

    try {
      const result = await this.provider.createRefund({
        refundId: refund.id,
        providerPaymentId: payment.providerPaymentId,
        amountMinor: refund.amountMinor,
      });

      const succeeded = result.status === "SUCCEEDED";

      await this.database.db
        .update(refunds)
        .set({
          providerRefundId: result.providerRefundId,
          status: result.status === "FAILED" ? "FAILED" : result.status,
          succeededAt: succeeded ? new Date() : null,
          failedAt: result.status === "FAILED" ? new Date() : null,
          failureCode: result.failureCode ?? null,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));

      if (succeeded) {
        await this.database.db
          .update(payments)
          .set({
            status:
              refund.amountMinor === payment.amountMinor
                ? "REFUNDED"
                : "PARTIALLY_REFUNDED",
            updatedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        await this.bookings.recordPaymentEvent(refund.bookingId, "REFUND_SUCCEEDED", {
          refundId: refund.id,
        });

        /*
         * The Host's money follows the Guest's. Before the Transfer the
         * Settlement is simply cancelled; after it the money has to be pulled
         * back, because refunding the charge does not undo a Transfer
         * (milestone 10 §18, §19).
         */
        const impact = await this.settlements.onRefund(refund.bookingId);
        if (impact.action === "CANCELLED") {
          await this.settlementJobs.cancelRelease(impact.id!);
        }
        if (impact.action === "REVERSAL_REQUESTED") {
          await this.settlementJobs.enqueueReversal(impact.id!);
        }
      }

      this.logger.log({
        event: "refund.processed",
        refundId: refund.id,
        status: result.status,
      });

      return { status: result.status };
    } catch (error) {
      // Back to PENDING so the queue's retry picks it up again; the row, not
      // the job, is what says a refund is owed.
      await this.database.db
        .update(refunds)
        .set({
          status: "PENDING",
          failureCode: error instanceof PaymentProviderError ? error.code : null,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));

      throw error;
    }
  }

  /**
   * Best-effort cancel of an intent whose hold has lapsed. Availability was
   * released without waiting for this (milestone 08 §27).
   */
  async cancelProviderPayment(paymentId: string): Promise<void> {
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!payment?.providerPaymentId) return;
    if (!OPEN.includes(payment.status as PaymentStatus)) return;

    const state = await this.provider.cancelPayment(
      payment.providerPaymentId,
      payment.id,
    );

    /*
     * The Guest may have completed the payment in the seconds between the hold
     * lapsing and this job running. Recording that as a cancel would leave a
     * charged card with no Booking and no Refund — so the provider's answer
     * decides, and a success is routed through the ordinary late-payment path,
     * which refunds it (milestone 08 §23, §27).
     */
    if (state && state.status !== "CANCELLED") {
      await this.applyProviderState(payment, state);
      return;
    }

    await this.database.db
      .update(payments)
      .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, OPEN)));
  }

  /** Open Payments belonging to a Booking, for the hold-expiry cleanup. */
  async openPaymentIdsFor(bookingId: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), inArray(payments.status, OPEN)));

    return rows.map((row) => row.id);
  }

}
