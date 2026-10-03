import { Module } from "@nestjs/common";

import { AccountModule } from "../account/account.module";
import { AuthModule } from "../auth/auth.module";
import { AvailabilityCoreModule } from "../availability/availability-core.module";
import { HostsModule } from "../hosts/hosts.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentCancelModule } from "../payments/payment-cancel.scheduler";
import { PaymentReadModule } from "../payments/payment-read.service";
import { StayScheduleModule } from "../stay/stay-schedule.canceller";
import { BookingHoldWorker } from "./booking-hold.worker";
import { BookingLifecycleWorker } from "./booking-lifecycle.worker";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { GuestAccessModule } from "./guest-access.module";
import { HostBookingsController } from "./host-bookings.controller";
import { IdempotencyService } from "./idempotency.service";

@Module({
  imports: [
    AuthModule,
    AvailabilityCoreModule,
    GuestAccessModule,
    NotificationsModule,
    HostsModule,
    AccountModule,
    PaymentCancelModule,
    PaymentReadModule,
    StayScheduleModule,
  ],
  controllers: [BookingsController, HostBookingsController],
  providers: [
    BookingsService,
    IdempotencyService,
    BookingHoldWorker,
    BookingLifecycleWorker,
  ],
  exports: [BookingsService, BookingHoldWorker, BookingLifecycleWorker],
})
export class BookingsModule {}
