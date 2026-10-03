import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BookingsModule } from "../bookings/bookings.module";
import { GuestAccessModule } from "../bookings/guest-access.module";
import { SettlementsModule } from "../settlements/settlements.module";
import { StayModule } from "../stay/stay.module";
import { GuestPaymentsController } from "./guest-payments.controller";
import { HostPaymentsController } from "./host-payments.controller";
import { PaymentProviderModule } from "./payment-provider.module";
import { PaymentWorker } from "./payment.worker";
import { PaymentsService } from "./payments.service";
import { WebhooksController } from "./webhooks.controller";

/**
 * Payments.
 *
 * The domain talks to `PAYMENT_PROVIDER`; only the provider module knows the
 * name Stripe. Tests bind a fake to the same token and exercise the whole flow
 * without a network (milestone 08 §2).
 */
@Module({
  imports: [
    AuthModule,
    BookingsModule,
    GuestAccessModule,
    StayModule,
    PaymentProviderModule,
    SettlementsModule,
  ],
  controllers: [GuestPaymentsController, WebhooksController, HostPaymentsController],
  providers: [PaymentsService, PaymentWorker],
  exports: [PaymentsService, PaymentWorker],
})
export class PaymentsModule {}
