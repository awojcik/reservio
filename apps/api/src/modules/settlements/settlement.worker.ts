import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker, type Queue } from "bullmq";
import type { Redis } from "ioredis";
import { eq, inArray } from "drizzle-orm";

import {
  REDIS_CONNECTION,
  SETTLEMENT_QUEUE,
  SETTLEMENT_QUEUE_NAME,
  queuePrefix,
  type SettlementJob,
} from "../../infrastructure/queue/queue.module";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  bookingSettlements,
  hostPaymentAccounts,
  hostPayouts,
  hostTransferReversals,
  hostTransfers,
} from "../../infrastructure/database/schema";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from "../payments/domain/payment-provider";
import { SettlementsService } from "./settlements.service";

export const RELEASE_JOB = "settlement-release";
export const TRANSFER_JOB = "settlement-transfer";
export const REVERSAL_JOB = "settlement-reversal";
export const RECONCILE_JOB = "financial-reconciliation";

/** Batches, so a growing table never turns into a full scan (milestone 10 §22). */
const BATCH = 100;

@Injectable()
export class SettlementWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SettlementWorker.name);
  private worker: Worker<SettlementJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(SETTLEMENT_QUEUE) private readonly queue: Queue<SettlementJob>,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly settlements: SettlementsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("DISABLE_SETTLEMENT_WORKER") === "true") return;
    this.start();
    await this.scheduleReconciliation();
  }

  /** Exposed so tests can drive the worker on their own terms. */
  start(): Worker<SettlementJob> {
    if (this.worker?.isRunning()) return this.worker;

    this.worker = new Worker<SettlementJob>(
      SETTLEMENT_QUEUE_NAME,
      async (job) => {
        switch (job.name) {
          case RELEASE_JOB:
            return this.settlements.release(job.data.settlementId!);
          case TRANSFER_JOB:
            return this.runTransfer(job.data.settlementId!);
          case REVERSAL_JOB:
            return this.settlements.processReversal(job.data.reversalId!);
          default:
            return this.reconcile();
        }
      },
      { connection: this.connection, concurrency: 2, prefix: queuePrefix(this.config) },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.warn({
        event: "settlement.job_failed",
        job: job?.name,
        attempts: job?.attemptsMade,
        reason: error.message,
      });
    });

    return this.worker;
  }

  /**
   * One release job per Settlement, delayed to its own `release_at`.
   *
   * The delay is a convenience, not the rule: the handler re-reads the row and
   * refuses to release early, and the reconciliation sweep catches anything
   * the queue forgot (milestone 10 §10).
   */
  async scheduleRelease(settlementId: string, releaseAt: Date): Promise<void> {
    await this.queue.add(
      RELEASE_JOB,
      { settlementId },
      {
        jobId: `settlement-release-${settlementId}`,
        delay: Math.max(0, releaseAt.getTime() - Date.now()),
      },
    );
  }

  async enqueueTransfer(settlementId: string): Promise<void> {
    await this.queue.add(
      TRANSFER_JOB,
      { settlementId },
      { jobId: `settlement-transfer-${settlementId}-${Date.now()}` },
    );
  }

  async enqueueReversal(reversalId: string): Promise<void> {
    await this.queue.add(
      REVERSAL_JOB,
      { reversalId },
      { jobId: `settlement-reversal-${reversalId}` },
    );
  }

  /**
   * Sends one Settlement's money to the Host.
   *
   * The claim, the provider call and the result are three separate steps: the
   * database decides who may send, Stripe's idempotency key decides that it
   * happens once, and the last short transaction records what happened
   * (milestone 10 §16).
   */
  async runTransfer(settlementId: string): Promise<{ transferred: boolean; reason?: string }> {
    const claim = await this.settlements.prepareTransfer(settlementId);
    if (!claim.ready) return { transferred: false, reason: claim.reason };

    const settlement = await this.settlements.byId(settlementId);

    try {
      const result = await this.provider.createTransfer({
        transferId: claim.transfer.id,
        providerAccountId: claim.providerAccountId,
        amountMinor: claim.transfer.amountMinor,
        currency: claim.transfer.currency,
        metadata: {
          settlementId,
          bookingId: settlement.bookingId,
          hostId: settlement.hostId,
        },
      });

      if (result.status === "FAILED") {
        await this.settlements.failTransfer(claim.transfer.id, null);
        return { transferred: false, reason: "PROVIDER_FAILED" };
      }

      await this.settlements.completeTransfer(claim.transfer.id, result.providerTransferId);
      return { transferred: true };
    } catch (error) {
      await this.settlements.failTransfer(claim.transfer.id, error);
      throw error;
    }
  }

  /**
   * The safety net behind every webhook and every job.
   *
   * Providers retry, queues lose jobs and processes die mid-flight; a periodic
   * pass that compares our record against theirs is what keeps "the Host was
   * paid" from depending on a single delivery (milestone 10 §22).
   */
  async reconcile(): Promise<{
    released: number;
    transfersRepaired: number;
    transfersRetried: number;
    reversalsRetried: number;
    payoutsObserved: number;
  }> {
    let released = 0;
    for (const id of await this.settlements.dueForRelease(BATCH)) {
      const result = await this.settlements.release(id);
      if (result.released) {
        released += 1;
        await this.enqueueTransfer(id);
      }
    }

    // A Transfer we started but never heard the end of: ask the provider.
    const stuck = await this.database.db
      .select()
      .from(hostTransfers)
      .where(inArray(hostTransfers.status, ["PENDING", "PROCESSING"]))
      .limit(BATCH);

    let transfersRepaired = 0;
    for (const transfer of stuck) {
      if (!transfer.providerTransferId) continue;

      const remote = await this.provider.getTransfer(transfer.providerTransferId);
      if (remote?.status === "SUCCEEDED") {
        await this.settlements.completeTransfer(transfer.id, remote.providerTransferId);
        transfersRepaired += 1;
      }
    }

    // Settlements owed money with no live Transfer — a failed attempt, or one
    // that could not run because the Host was not onboarded yet.
    const retryable = await this.database.db
      .select({ id: bookingSettlements.id })
      .from(bookingSettlements)
      .where(inArray(bookingSettlements.status, ["AVAILABLE", "TRANSFER_PENDING"]))
      .limit(BATCH);

    let transfersRetried = 0;
    for (const settlement of retryable) {
      const result = await this.runTransfer(settlement.id).catch(() => ({
        transferred: false,
      }));
      if (result.transferred) transfersRetried += 1;
    }

    const pendingReversals = await this.database.db
      .select({ id: hostTransferReversals.id })
      .from(hostTransferReversals)
      .where(eq(hostTransferReversals.status, "PENDING"))
      .limit(BATCH);

    let reversalsRetried = 0;
    for (const reversal of pendingReversals) {
      const result = await this.settlements
        .processReversal(reversal.id)
        .catch(() => ({ status: "FAILED" }));
      if (result.status === "SUCCEEDED") reversalsRetried += 1;
    }

    const payoutsObserved = await this.observePayouts();

    this.logger.log({
      event: "settlement.reconciled",
      released,
      transfersRepaired,
      transfersRetried,
      reversalsRetried,
      payoutsObserved,
    });

    const result = {
      released,
      transfersRepaired,
      transfersRetried,
      reversalsRetried,
      payoutsObserved,
    };
    await this.recordRun(result);

    return result;
  }

  /**
   * Telemetry about the last run, so the admin panel can show one that nobody
   * triggered by hand (milestone 11 §33).
   *
   * Redis rather than a table, and deliberately so: this is a note about a
   * job, not a fact about money. Losing it costs a line on a screen and
   * nothing else, which is exactly the trade Redis is trusted with here — the
   * mismatches themselves are counted from PostgreSQL every time they are
   * asked for.
   */
  private async recordRun(result: Record<string, number>): Promise<void> {
    await this.connection
      .set(
        `${queuePrefix(this.config)}:reconciliation:last-run`,
        JSON.stringify({ at: new Date().toISOString(), ...result }),
      )
      .catch(() => undefined);
  }

  /** Null when the note is gone — a flushed Redis, or no run yet. */
  async lastRun(): Promise<({ at: string } & Record<string, number>) | null> {
    const raw = await this.connection
      .get(`${queuePrefix(this.config)}:reconciliation:last-run`)
      .catch(() => null);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as { at: string } & Record<string, number>;
    } catch {
      return null;
    }
  }

  /**
   * Payouts are the provider's to make, so they are observed rather than
   * driven. What matters is that a Host can see where their money is
   * (milestone 10 §17).
   */
  async observePayouts(): Promise<number> {
    const accounts = await this.database.db
      .select()
      .from(hostPaymentAccounts)
      .where(eq(hostPaymentAccounts.onboardingStatus, "READY"))
      .limit(BATCH);

    let observed = 0;
    for (const account of accounts) {
      const payouts = await this.provider
        .listPayouts(account.providerAccountId, 10)
        .catch(() => []);

      for (const payout of payouts) {
        await this.recordPayout(account.hostId, payout);
        observed += 1;
      }
    }

    return observed;
  }

  /** Upsert on the provider id, so repeated observation is free. */
  async recordPayout(
    hostId: string,
    payout: {
      providerPayoutId: string;
      amountMinor: number;
      currency: string;
      status: string;
      arrivalAt: Date | null;
      failureCode?: string | null;
      failureMessage?: string | null;
    },
  ): Promise<void> {
    const values = {
      hostId,
      providerPayoutId: payout.providerPayoutId,
      amountMinor: payout.amountMinor,
      currency: payout.currency,
      status: payout.status,
      arrivalAt: payout.arrivalAt,
      paidAt: payout.status === "PAID" ? new Date() : null,
      failedAt: payout.status === "FAILED" ? new Date() : null,
      failureCode: payout.failureCode ?? null,
      failureMessage: payout.failureMessage ?? null,
      updatedAt: new Date(),
    };

    await this.database.db
      .insert(hostPayouts)
      .values(values)
      .onConflictDoUpdate({ target: hostPayouts.providerPayoutId, set: values });
  }

  /**
   * A payout seen on the wire. The connected account tells us which Host it
   * belongs to; an event for an account we do not know is ignored rather than
   * guessed at.
   */
  async recordPayoutFromEvent(payout: {
    providerPayoutId: string;
    providerAccountId: string | null;
    amountMinor: number;
    currency: string;
    status: string;
    arrivalAt: Date | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  }): Promise<{ recorded: boolean }> {
    if (!payout.providerAccountId) return { recorded: false };

    const [account] = await this.database.db
      .select({ hostId: hostPaymentAccounts.hostId })
      .from(hostPaymentAccounts)
      .where(eq(hostPaymentAccounts.providerAccountId, payout.providerAccountId))
      .limit(1);

    if (!account) return { recorded: false };

    await this.recordPayout(account.hostId, payout);
    this.logger.log({
      event: "payout.observed",
      hostId: account.hostId,
      status: payout.status,
    });

    return { recorded: true };
  }

  async scheduleReconciliation(): Promise<void> {
    const minutes = Number(this.config.get("SETTLEMENT_RECONCILE_MINUTES") ?? 15);

    await this.queue.upsertJobScheduler(
      "financial-reconciliation",
      { every: minutes * 60 * 1000 },
      { name: RECONCILE_JOB, data: {} },
    );
  }

  /** Drops the scheduled release for a Settlement that will not happen. */
  async cancelRelease(settlementId: string): Promise<void> {
    await this.queue.remove(`settlement-release-${settlementId}`).catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
