import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import {
  bookingSettlements,
  bookings,
  hostPaymentAccounts,
  hostTransferReversals,
  hostTransfers,
  payments,
  refunds,
  type BookingSettlementRow,
  type HostTransferRow,
  type SettlementStatus,
} from "../../infrastructure/database/schema";
import { BookingsService } from "../bookings/bookings.service";
import { StayService } from "../stay/stay.service";
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentProvider,
} from "../payments/domain/payment-provider";

/** Settlement is not a transfer, and a transfer is not a payout (milestone 10 §1). */
export class SettlementNotReleasableError extends ConflictException {
  constructor(message = "Tego rozliczenia nie można teraz zwolnić.") {
    super({ code: "SETTLEMENT_NOT_RELEASABLE", message });
  }
}

/** Statuses from which money can still be sent to the Host. */
const TRANSFERABLE: SettlementStatus[] = ["AVAILABLE", "TRANSFER_PENDING"];

/** Statuses in which the Host is still owed the money. */
const OWED: SettlementStatus[] = [
  "PENDING",
  "AVAILABLE",
  "TRANSFER_PENDING",
  "FAILED",
];

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly stay: StayService,
    private readonly bookings: BookingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * How long after check-in the money is released.
   *
   * Configuration, not a constant in the domain: a marketplace tuning its risk
   * appetite should not need a deploy, and tests need it at zero
   * (milestone 10 §3).
   */
  private get releaseDelayHours(): number {
    return Number(this.config.get("HOST_SETTLEMENT_RELEASE_DELAY_HOURS") ?? 24);
  }

  private get sandbox(): boolean {
    const key = this.config.get<string>("STRIPE_SECRET_KEY") ?? "";
    return this.config.get("NODE_ENV") !== "production" && !key.startsWith("sk_live_");
  }

  // -------------------------------------------------------------- creation

  /**
   * Opens the Settlement for a Booking whose payment succeeded.
   *
   * Idempotent by the unique key on `booking_id`: a replayed webhook, a
   * reconciliation pass and the confirmation itself all converge on one row
   * (milestone 10 §9).
   */
  async createFor(bookingId: string): Promise<BookingSettlementRow | null> {
    const existing = await this.findByBooking(bookingId);
    if (existing) return existing;

    const [row] = await this.database.db
      .select({ booking: bookings, payment: payments })
      .from(bookings)
      .innerJoin(payments, eq(payments.bookingId, bookings.id))
      .where(and(eq(bookings.id, bookingId), eq(payments.status, "SUCCEEDED")))
      .limit(1);

    if (!row) return null;
    if (row.booking.status !== "CONFIRMED" && row.booking.status !== "COMPLETED") {
      return null;
    }

    /*
     * Straight from the Booking's own snapshot and the fee recorded on the
     * Payment. Repricing an old Booking with today's commission would rewrite
     * what the Host was promised (milestone 10 §7).
     */
    const gross = row.booking.totalAmountMinor;
    const platformFee = Math.min(row.payment.platformFeeAmountMinor, gross);

    const releaseAt = await this.releaseAtFor(bookingId);

    const inserted = await this.database.db
      .insert(bookingSettlements)
      .values({
        bookingId,
        hostId: row.booking.hostId,
        propertyId: row.booking.propertyId,
        currency: row.booking.currency,
        grossAmountMinor: gross,
        platformFeeMinor: platformFee,
        hostAmountMinor: gross - platformFee,
        releaseAt,
      })
      .onConflictDoNothing()
      .returning();

    // Lost a concurrent create; the winner's row is the Settlement.
    if (inserted.length === 0) return this.findByBooking(bookingId);

    await this.bookings.recordPaymentEvent(bookingId, "SETTLEMENT_CREATED", {
      settlementId: inserted[0].id,
      hostAmountMinor: inserted[0].hostAmountMinor,
    });

    this.logger.log({
      event: "settlement.created",
      settlementId: inserted[0].id,
      bookingId,
      hostAmountMinor: inserted[0].hostAmountMinor,
      releaseAt: releaseAt.toISOString(),
    });

    return inserted[0];
  }

  /**
   * Check-in in the Property's own time zone, plus the configured delay.
   *
   * The instant is stored, not recomputed: a Host changing their check-in time
   * next season must not move money that was already promised on the old terms.
   */
  private async releaseAtFor(bookingId: string): Promise<Date> {
    const schedule = await this.stay.scheduleFor(bookingId);
    const checkInAt = schedule?.window.checkInAt ?? new Date();

    return new Date(checkInAt.getTime() + this.releaseDelayHours * 3_600_000);
  }

  // --------------------------------------------------------------- release

  /**
   * `PENDING → AVAILABLE`, once the money has been earned and nothing has
   * clawed it back.
   *
   * The queue is not the authority here: the job only asks whether the row's
   * own `release_at` has passed, so a job lost to a Redis flush costs a delay,
   * never a wrong outcome (milestone 10 §10, §11).
   */
  async release(
    settlementId: string,
    options: { ignoreSchedule?: boolean } = {},
  ): Promise<{ released: boolean; reason?: string }> {
    const outcome = await this.database.db.transaction(async (tx) => {
      const settlement = await this.lock(tx, settlementId);
      if (!settlement) return { released: false, reason: "NOT_FOUND" };
      if (settlement.status === "AVAILABLE") return { released: false, reason: "ALREADY" };
      if (settlement.status !== "PENDING") {
        return { released: false, reason: settlement.status };
      }

      if (!options.ignoreSchedule && settlement.releaseAt.getTime() > Date.now()) {
        return { released: false, reason: "TOO_EARLY" };
      }

      const blocked = await this.blockedReason(tx, settlement);
      if (blocked) return { released: false, reason: blocked };

      await tx
        .update(bookingSettlements)
        .set({ status: "AVAILABLE", availableAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(bookingSettlements.id, settlementId), eq(bookingSettlements.status, "PENDING")),
        );

      return { released: true };
    });

    if (outcome.released) {
      await this.bookings.recordPaymentEvent(
        (await this.byId(settlementId)).bookingId,
        "SETTLEMENT_RELEASED",
        { settlementId },
      );
      this.logger.log({ event: "settlement.released", settlementId });
    }

    return outcome;
  }

  /** Why this Settlement must not be released, or null when it may be. */
  private async blockedReason(
    tx: Executor,
    settlement: BookingSettlementRow,
  ): Promise<string | null> {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, settlement.bookingId))
      .limit(1);

    // A Stay that was called off never earned anything.
    if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
      return `BOOKING_${booking.status}`;
    }

    /*
     * Money on its way back to the Guest outranks everything else: a refund in
     * flight means the Host is not going to be paid for this Stay, whatever
     * the Payment row currently says.
     */
    const owedBack = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.bookingId, settlement.bookingId),
          inArray(refunds.status, ["PENDING", "PROCESSING", "SUCCEEDED"]),
        ),
      )
      .limit(1);

    if (owedBack.length > 0) return "REFUND_IN_PROGRESS";

    // "Did it ever succeed", not "is it still SUCCEEDED": a Payment that has
    // since moved to REFUND_PENDING did in fact take the Guest's money.
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.bookingId, settlement.bookingId))
      .orderBy(sql`${payments.createdAt} DESC`)
      .limit(1);

    return payment?.succeededAt ? null : "PAYMENT_NOT_SUCCEEDED";
  }

  /** Settlements whose release instant has passed and which are still PENDING. */
  async dueForRelease(limit = 100): Promise<string[]> {
    const rows = await this.database.db
      .select({ id: bookingSettlements.id })
      .from(bookingSettlements)
      .where(
        and(
          eq(bookingSettlements.status, "PENDING"),
          lte(bookingSettlements.releaseAt, new Date()),
        ),
      )
      .limit(limit);

    return rows.map((row) => row.id);
  }

  /**
   * The sandbox shortcut. Uses the same command and the same invariants — it
   * only skips waiting for the clock (milestone 10 §27).
   */
  async releaseNow(hostId: string, settlementId: string): Promise<BookingSettlementRow> {
    if (!this.sandbox) {
      throw new SettlementNotReleasableError(
        "Ręczne zwolnienie środków jest dostępne tylko w środowisku testowym.",
      );
    }

    const settlement = await this.ownedById(hostId, settlementId);
    const result = await this.release(settlement.id, { ignoreSchedule: true });

    if (!result.released && result.reason !== "ALREADY") {
      throw new SettlementNotReleasableError(describeBlock(result.reason));
    }

    return this.byId(settlementId);
  }

  // -------------------------------------------------------------- transfer

  /**
   * Claims the Settlement for a Transfer and returns the Transfer row to send.
   *
   * The provider call happens outside this transaction: a network round trip
   * inside an open transaction holds a row lock for its duration, and a
   * timeout would roll back a Transfer that really exists (milestone 10 §16).
   */
  async prepareTransfer(
    settlementId: string,
  ): Promise<
    | { ready: true; transfer: HostTransferRow; providerAccountId: string }
    | { ready: false; reason: string }
  > {
    return this.database.db.transaction(async (tx) => {
      const settlement = await this.lock(tx, settlementId);
      if (!settlement) return { ready: false as const, reason: "NOT_FOUND" };

      if (settlement.status === "TRANSFERRED") {
        return { ready: false as const, reason: "ALREADY_TRANSFERRED" };
      }
      if (!TRANSFERABLE.includes(settlement.status as SettlementStatus)) {
        return { ready: false as const, reason: settlement.status };
      }

      const blocked = await this.blockedReason(tx, settlement);
      if (blocked) return { ready: false as const, reason: blocked };

      const [account] = await tx
        .select()
        .from(hostPaymentAccounts)
        .where(eq(hostPaymentAccounts.hostId, settlement.hostId))
        .limit(1);

      /*
       * A Host who has not finished onboarding is not a failure: the money is
       * theirs and stays AVAILABLE until they can receive it
       * (milestone 10 §14).
       */
      if (!account || account.onboardingStatus !== "READY") {
        return { ready: false as const, reason: "HOST_NOT_READY" };
      }

      // At most one live Transfer per Settlement, enforced by a partial unique
      // index — two workers cannot pay the Host twice.
      const [existing] = await tx
        .select()
        .from(hostTransfers)
        .where(
          and(
            eq(hostTransfers.settlementId, settlementId),
            inArray(hostTransfers.status, ["PENDING", "PROCESSING", "SUCCEEDED"]),
          ),
        )
        .limit(1);

      if (existing?.status === "SUCCEEDED") {
        return { ready: false as const, reason: "ALREADY_TRANSFERRED" };
      }

      /*
       * A row already in PROCESSING means another worker is mid-call to the
       * provider. Waiting on the settlement lock is not enough on its own —
       * the loser would go on to make a second provider call. The claim is the
       * transition into PROCESSING, and only one worker gets it.
       *
       * A worker that dies here leaves the row in PROCESSING; reconciliation
       * asks the provider what actually happened (milestone 10 §22).
       */
      if (existing?.status === "PROCESSING") {
        return { ready: false as const, reason: "IN_PROGRESS" };
      }

      const transfer =
        existing ??
        (
          await tx
            .insert(hostTransfers)
            .values({
              settlementId,
              hostId: settlement.hostId,
              amountMinor: settlement.hostAmountMinor,
              currency: settlement.currency,
              status: "PENDING",
            })
            .returning()
        )[0];

      await tx
        .update(hostTransfers)
        .set({ status: "PROCESSING", updatedAt: new Date() })
        .where(eq(hostTransfers.id, transfer.id));

      await tx
        .update(bookingSettlements)
        .set({ status: "TRANSFER_PENDING", updatedAt: new Date() })
        .where(eq(bookingSettlements.id, settlementId));

      return {
        ready: true as const,
        transfer,
        providerAccountId: account.providerAccountId,
      };
    });
  }

  /** Records what the provider said about a Transfer. */
  async completeTransfer(
    transferId: string,
    providerTransferId: string,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [transfer] = await tx
        .update(hostTransfers)
        .set({
          providerTransferId,
          status: "SUCCEEDED",
          succeededAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(hostTransfers.id, transferId))
        .returning();

      await tx
        .update(bookingSettlements)
        .set({
          status: "TRANSFERRED",
          providerTransferId,
          transferredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bookingSettlements.id, transfer.settlementId));
    });

    const settlement = await this.byId(
      (await this.transferById(transferId)).settlementId,
    );

    await this.bookings.recordPaymentEvent(
      settlement.bookingId,
      "HOST_TRANSFER_SUCCEEDED",
      { transferId, amountMinor: settlement.hostAmountMinor },
    );

    this.logger.log({
      event: "settlement.transferred",
      settlementId: settlement.id,
      transferId,
    });
  }

  /**
   * Records a failed attempt. The Settlement goes back to AVAILABLE rather
   * than to a dead end: the Host is still owed the money, and the next attempt
   * should find it waiting (milestone 10 §16).
   */
  async failTransfer(transferId: string, error: unknown): Promise<void> {
    const code = error instanceof PaymentProviderError ? error.code : null;

    await this.database.db.transaction(async (tx) => {
      const [transfer] = await tx
        .update(hostTransfers)
        .set({
          status: "FAILED",
          failedAt: new Date(),
          failureCode: code,
          updatedAt: new Date(),
        })
        .where(eq(hostTransfers.id, transferId))
        .returning();

      await tx
        .update(bookingSettlements)
        .set({ status: "AVAILABLE", failureCode: code, updatedAt: new Date() })
        .where(
          and(
            eq(bookingSettlements.id, transfer.settlementId),
            eq(bookingSettlements.status, "TRANSFER_PENDING"),
          ),
        );
    });

    this.logger.warn({ event: "settlement.transfer_failed", transferId, code });
  }

  // ------------------------------------------------------- refund reaction

  /**
   * What a completed full refund means for the Host's money.
   *
   * Before the Transfer the Settlement is simply cancelled. After it, the
   * money is already in the Host's account and has to be pulled back — under
   * Separate Charges and Transfers, refunding the charge does not undo the
   * Transfer (milestone 10 §18, §19).
   */
  async onRefund(bookingId: string): Promise<{ action: string; id?: string }> {
    const settlement = await this.findByBooking(bookingId);
    if (!settlement) return { action: "NO_SETTLEMENT" };

    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .limit(1);

    const [refund] = await this.database.db
      .select()
      .from(refunds)
      .where(eq(refunds.bookingId, bookingId))
      .limit(1);

    // Partial-refund accounting is deliberately out of scope; anything less
    // than the whole payment leaves the Settlement alone (milestone 10 §20).
    if (!refund || refund.amountMinor < payment.amountMinor) {
      return { action: "PARTIAL_IGNORED" };
    }

    if (settlement.status === "TRANSFERRED") {
      return this.requestReversal(settlement);
    }

    if (settlement.status === "REVERSAL_PENDING" || settlement.status === "REVERSED") {
      return { action: "ALREADY_REVERSING" };
    }

    const cancelled = await this.database.db
      .update(bookingSettlements)
      .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(bookingSettlements.id, settlement.id),
          inArray(bookingSettlements.status, ["PENDING", "AVAILABLE", "FAILED"]),
        ),
      )
      .returning({ id: bookingSettlements.id });

    if (cancelled.length === 0) return { action: "NOT_CANCELLABLE" };

    await this.bookings.recordPaymentEvent(bookingId, "SETTLEMENT_CANCELLED", {
      settlementId: settlement.id,
    });
    this.logger.log({ event: "settlement.cancelled", settlementId: settlement.id });

    return { action: "CANCELLED", id: settlement.id };
  }

  /**
   * Records the decision to pull a Transfer back. The unique key on
   * `(transfer_id, reason)` makes "exactly one reversal" a database guarantee
   * (milestone 10 §20).
   */
  private async requestReversal(
    settlement: BookingSettlementRow,
  ): Promise<{ action: string; id?: string }> {
    const [transfer] = await this.database.db
      .select()
      .from(hostTransfers)
      .where(
        and(
          eq(hostTransfers.settlementId, settlement.id),
          eq(hostTransfers.status, "SUCCEEDED"),
        ),
      )
      .limit(1);

    if (!transfer) return { action: "NO_TRANSFER" };

    const inserted = await this.database.db
      .insert(hostTransferReversals)
      .values({
        transferId: transfer.id,
        settlementId: settlement.id,
        amountMinor: transfer.amountMinor,
        currency: transfer.currency,
        reason: "REFUNDED_AFTER_TRANSFER",
      })
      .onConflictDoNothing()
      .returning({ id: hostTransferReversals.id });

    await this.database.db
      .update(bookingSettlements)
      .set({ status: "REVERSAL_PENDING", updatedAt: new Date() })
      .where(
        and(
          eq(bookingSettlements.id, settlement.id),
          eq(bookingSettlements.status, "TRANSFERRED"),
        ),
      );

    await this.database.db
      .update(hostTransfers)
      .set({ status: "REVERSAL_PENDING", updatedAt: new Date() })
      .where(eq(hostTransfers.id, transfer.id));

    if (inserted.length === 0) {
      const [existing] = await this.database.db
        .select({ id: hostTransferReversals.id })
        .from(hostTransferReversals)
        .where(eq(hostTransferReversals.transferId, transfer.id))
        .limit(1);

      return { action: "REVERSAL_EXISTS", id: existing.id };
    }

    this.logger.log({
      event: "settlement.reversal_requested",
      settlementId: settlement.id,
      reversalId: inserted[0].id,
    });

    return { action: "REVERSAL_REQUESTED", id: inserted[0].id };
  }

  /** Carries out a recorded reversal against the provider. */
  async processReversal(reversalId: string): Promise<{ status: string }> {
    const [reversal] = await this.database.db
      .select()
      .from(hostTransferReversals)
      .where(eq(hostTransferReversals.id, reversalId))
      .limit(1);

    if (!reversal) throw new NotFoundException("Nie znaleziono cofnięcia przelewu.");
    if (reversal.status === "SUCCEEDED") return { status: "SUCCEEDED" };

    const transfer = await this.transferById(reversal.transferId);
    if (!transfer.providerTransferId) {
      await this.database.db
        .update(hostTransferReversals)
        .set({
          status: "FAILED",
          failedAt: new Date(),
          failureCode: "NO_PROVIDER_TRANSFER",
          updatedAt: new Date(),
        })
        .where(eq(hostTransferReversals.id, reversalId));

      return { status: "FAILED" };
    }

    await this.database.db
      .update(hostTransferReversals)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(hostTransferReversals.id, reversalId));

    try {
      const result = await this.provider.createTransferReversal({
        reversalId,
        providerTransferId: transfer.providerTransferId,
        amountMinor: reversal.amountMinor,
      });

      const succeeded = result.status === "SUCCEEDED";

      await this.database.db
        .update(hostTransferReversals)
        .set({
          providerReversalId: result.providerReversalId,
          status: succeeded ? "SUCCEEDED" : result.status === "FAILED" ? "FAILED" : "PROCESSING",
          succeededAt: succeeded ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(hostTransferReversals.id, reversalId));

      if (succeeded) {
        await this.database.db
          .update(hostTransfers)
          .set({ status: "REVERSED", reversedAt: new Date(), updatedAt: new Date() })
          .where(eq(hostTransfers.id, transfer.id));

        await this.database.db
          .update(bookingSettlements)
          .set({ status: "REVERSED", updatedAt: new Date() })
          .where(eq(bookingSettlements.id, reversal.settlementId));

        const settlement = await this.byId(reversal.settlementId);
        await this.bookings.recordPaymentEvent(
          settlement.bookingId,
          "HOST_TRANSFER_REVERSED",
          { reversalId },
        );
      }

      this.logger.log({ event: "settlement.reversed", reversalId, status: result.status });
      return { status: result.status };
    } catch (error) {
      // Back to PENDING so the queue retries; the row is what says money is owed.
      await this.database.db
        .update(hostTransferReversals)
        .set({
          status: "PENDING",
          failureCode: error instanceof PaymentProviderError ? error.code : null,
          updatedAt: new Date(),
        })
        .where(eq(hostTransferReversals.id, reversalId));

      throw error;
    }
  }

  /**
   * A transfer event from the provider.
   *
   * Out-of-order safe: the event only ever confirms what our own row already
   * says, and a reversal seen on the wire moves the Settlement to REVERSED
   * whether or not our reversal job got there first (milestone 10 §23).
   */
  async applyTransferEvent(event: {
    providerTransferId: string;
    reversed: boolean;
  }): Promise<{ applied: boolean }> {
    const [transfer] = await this.database.db
      .select()
      .from(hostTransfers)
      .where(eq(hostTransfers.providerTransferId, event.providerTransferId))
      .limit(1);

    // A transfer Rezervio never made, or one from another environment sharing
    // the same sandbox account.
    if (!transfer) return { applied: false };

    if (event.reversed) {
      await this.database.db
        .update(hostTransfers)
        .set({ status: "REVERSED", reversedAt: new Date(), updatedAt: new Date() })
        .where(eq(hostTransfers.id, transfer.id));

      await this.database.db
        .update(bookingSettlements)
        .set({ status: "REVERSED", updatedAt: new Date() })
        .where(
          and(
            eq(bookingSettlements.id, transfer.settlementId),
            inArray(bookingSettlements.status, ["TRANSFERRED", "REVERSAL_PENDING"]),
          ),
        );

      return { applied: true };
    }

    if (transfer.status === "PENDING" || transfer.status === "PROCESSING") {
      await this.completeTransfer(transfer.id, event.providerTransferId);
      return { applied: true };
    }

    return { applied: false };
  }

  // ---------------------------------------------------------------- reads

  /**
   * The Host's money, derived from the Settlements themselves.
   *
   * No mutable balance column: a stored total is a second source of truth that
   * drifts the first time an update is missed (milestone 10 §24).
   */
  async summaryFor(hostId: string): Promise<{
    currency: string;
    pendingMinor: number;
    availableMinor: number;
    transferredMinor: number;
    cancelledMinor: number;
    reversedMinor: number;
  }> {
    const rows = (await this.database.db.execute(sql`
      SELECT status, currency, SUM(host_amount_minor)::bigint AS total
      FROM booking_settlements
      WHERE host_id = ${hostId}
      GROUP BY status, currency
    `)) as unknown as { status: string; currency: string; total: string }[];

    const sum = (statuses: string[]) =>
      rows
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + Number(row.total), 0);

    return {
      currency: rows[0]?.currency ?? "PLN",
      pendingMinor: sum(["PENDING"]),
      availableMinor: sum(["AVAILABLE", "TRANSFER_PENDING", "FAILED"]),
      transferredMinor: sum(["TRANSFERRED"]),
      cancelledMinor: sum(["CANCELLED"]),
      reversedMinor: sum(["REVERSED"]),
    };
  }

  async listForHost(hostId: string, limit = 50, offset = 0) {
    return this.database.db
      .select({
        settlement: bookingSettlements,
        reference: bookings.publicReference,
        propertyTitle: bookings.propertyTitleSnapshot,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
        transferStatus: hostTransfers.status,
      })
      .from(bookingSettlements)
      .innerJoin(bookings, eq(bookings.id, bookingSettlements.bookingId))
      .leftJoin(
        hostTransfers,
        and(
          eq(hostTransfers.settlementId, bookingSettlements.id),
          inArray(hostTransfers.status, ["PROCESSING", "SUCCEEDED", "REVERSAL_PENDING", "REVERSED"]),
        ),
      )
      .where(eq(bookingSettlements.hostId, hostId))
      .orderBy(sql`${bookingSettlements.createdAt} DESC`)
      .limit(limit)
      .offset(offset);
  }

  async findByBooking(bookingId: string): Promise<BookingSettlementRow | null> {
    const [row] = await this.database.db
      .select()
      .from(bookingSettlements)
      .where(eq(bookingSettlements.bookingId, bookingId))
      .limit(1);

    return row ?? null;
  }

  async byId(settlementId: string): Promise<BookingSettlementRow> {
    const [row] = await this.database.db
      .select()
      .from(bookingSettlements)
      .where(eq(bookingSettlements.id, settlementId))
      .limit(1);

    if (!row) throw new NotFoundException("Nie znaleziono rozliczenia.");
    return row;
  }

  /** 404 rather than 403: an id that is not yours should not be confirmed. */
  async ownedById(hostId: string, settlementId: string): Promise<BookingSettlementRow> {
    const row = await this.byId(settlementId);
    if (row.hostId !== hostId) throw new NotFoundException("Nie znaleziono rozliczenia.");
    return row;
  }

  async transferById(transferId: string): Promise<HostTransferRow> {
    const [row] = await this.database.db
      .select()
      .from(hostTransfers)
      .where(eq(hostTransfers.id, transferId))
      .limit(1);

    if (!row) throw new NotFoundException("Nie znaleziono przelewu.");
    return row;
  }

  /** Settlements still owing money, for the "not yet paid out" views. */
  owedStatuses(): SettlementStatus[] {
    return OWED;
  }

  /**
   * Row-level lock on the Settlement itself.
   *
   * The financial state machine is serialised on its own row — the Property
   * advisory lock guards inventory, which is a different question entirely
   * (milestone 10 §21).
   */
  private async lock(
    tx: Executor,
    settlementId: string,
  ): Promise<BookingSettlementRow | null> {
    const [row] = await tx
      .select()
      .from(bookingSettlements)
      .where(eq(bookingSettlements.id, settlementId))
      .limit(1)
      .for("update");

    return row ?? null;
  }
}

function describeBlock(reason?: string): string {
  switch (reason) {
    case "TOO_EARLY":
      return "Termin zwolnienia środków jeszcze nie minął.";
    case "REFUND_IN_PROGRESS":
      return "Dla tej rezerwacji trwa zwrot — środki nie zostaną zwolnione.";
    case "HOST_NOT_READY":
      return "Dokończ konfigurację płatności, aby otrzymać środki.";
    default:
      return "Tego rozliczenia nie można teraz zwolnić.";
  }
}
