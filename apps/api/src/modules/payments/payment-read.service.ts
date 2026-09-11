import { Inject, Injectable, Module } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { payments, refunds } from "../../infrastructure/database/schema";
import type { PaymentStateDto } from "./dto/payment.dto";

/**
 * The money side of a Booking, for whoever renders the Booking.
 *
 * Read-only and dependency-free on purpose: the Bookings module needs it, and
 * pulling in the whole payments module — which depends on Bookings — would be
 * a cycle. There is nothing to write here, so there is nothing to duplicate.
 */
@Injectable()
export class PaymentReadService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async forBooking(bookingId: string): Promise<PaymentStateDto | null> {
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    if (!payment) return null;

    const [refund] = await this.database.db
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.paymentId, payment.id))
      .limit(1);

    return {
      status: payment.status,
      // Stripe's decline message is Guest-safe: it never contains card data.
      failureMessage: payment.failureMessage,
      refunded: refund !== undefined,
    };
  }
}

@Module({
  providers: [PaymentReadService],
  exports: [PaymentReadService],
})
export class PaymentReadModule {}
