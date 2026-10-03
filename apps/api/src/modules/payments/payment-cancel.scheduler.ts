import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { Queue } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { payments } from "../../infrastructure/database/schema";
import {
  CANCEL_QUEUE,
  type PaymentCancelJob,
} from "../../infrastructure/queue/queue.module";

/**
 * Tells the provider that an in-flight PaymentIntent will not be used.
 *
 * Split out of `PaymentsService` on purpose: the Bookings module needs this
 * one call when a hold lapses, and importing the whole payments module — which
 * itself depends on Bookings — would be a cycle for no gain.
 *
 * Strictly best effort. Availability is released by the hold expiry itself,
 * without waiting for anything here (milestone 08 §27).
 */
@Injectable()
export class PaymentCancelScheduler {
  private readonly logger = new Logger(PaymentCancelScheduler.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CANCEL_QUEUE) private readonly queue: Queue<PaymentCancelJob>,
  ) {}

  async cancelOpenPayments(bookingId: string): Promise<number> {
    const open = await this.database.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          inArray(payments.status, ["CREATED", "PROCESSING", "REQUIRES_ACTION"]),
        ),
      );

    for (const payment of open) {
      await this.queue.add(
        "cancel",
        { paymentId: payment.id },
        { jobId: `payment-cancel-${payment.id}` },
      );
    }

    if (open.length > 0) {
      this.logger.log({ event: "payment.cancel_enqueued", bookingId, count: open.length });
    }

    return open.length;
  }
}

@Module({
  providers: [PaymentCancelScheduler],
  exports: [PaymentCancelScheduler],
})
export class PaymentCancelModule {}
