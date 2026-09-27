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

import {
  CANCEL_QUEUE,
  PAYMENT_CANCEL_QUEUE,
  PAYMENT_REFUND_QUEUE,
  REDIS_CONNECTION,
  queuePrefix,
  workerConcurrency,
  type PaymentCancelJob,
  type PaymentRefundJob,
} from "../../infrastructure/queue/queue.module";
import { PaymentsService } from "./payments.service";

/**
 * Carries out refunds and best-effort provider cancels off the request thread.
 *
 * The queue is a delivery mechanism, never the decision: the Refund row in
 * PostgreSQL is what says money is owed, and it survives Redis being wiped
 * (milestone 08 §25).
 */
@Injectable()
export class PaymentWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentWorker.name);
  private refundWorker: Worker<PaymentRefundJob> | null = null;
  private cancelWorker: Worker<PaymentCancelJob> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(CANCEL_QUEUE) private readonly cancelQueue: Queue<PaymentCancelJob>,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get("DISABLE_PAYMENT_WORKER") === "true") return;
    this.start();
  }

  /** Exposed so tests can drive the workers on their own terms. */
  start(): void {
    if (!this.refundWorker?.isRunning()) {
      this.refundWorker = new Worker<PaymentRefundJob>(
        PAYMENT_REFUND_QUEUE,
        async (job) => this.payments.processRefund(job.data.refundId),
        {
          connection: this.connection,
          concurrency: workerConcurrency(this.config, 2),
          prefix: queuePrefix(this.config),
        },
      );

      this.refundWorker.on("failed", (job, error) => {
        this.logger.warn({
          event: "refund.attempt_failed",
          jobId: job?.id,
          attempts: job?.attemptsMade,
          reason: error.message,
        });
      });
    }

    if (!this.cancelWorker?.isRunning()) {
      this.cancelWorker = new Worker<PaymentCancelJob>(
        PAYMENT_CANCEL_QUEUE,
        async (job) => this.payments.cancelProviderPayment(job.data.paymentId),
        {
          connection: this.connection,
          concurrency: workerConcurrency(this.config, 2),
          prefix: queuePrefix(this.config),
        },
      );

      this.cancelWorker.on("failed", (job, error) => {
        // Nothing depends on this: availability was already released.
        this.logger.log({
          event: "payment.cancel_failed",
          jobId: job?.id,
          reason: error.message,
        });
      });
    }
  }

  async enqueueProviderCancel(paymentId: string): Promise<void> {
    await this.cancelQueue.add(
      "cancel",
      { paymentId },
      { jobId: `payment-cancel-${paymentId}` },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.refundWorker?.close();
    await this.cancelWorker?.close();
    this.refundWorker = null;
    this.cancelWorker = null;
  }
}
