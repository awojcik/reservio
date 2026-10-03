import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BookingsModule } from "../bookings/bookings.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { HostStayController } from "./host-stay.controller";
import { StayLifecycleWorker } from "./stay-lifecycle.worker";
import { StaySecretCipher } from "./stay-secret-cipher";
import { StayService } from "./stay.service";

/**
 * Stay information and the lifecycle around it: what the Guest is told, when
 * they are told it, and when the Booking closes itself.
 */
@Module({
  imports: [AuthModule, BookingsModule, NotificationsModule],
  controllers: [HostStayController],
  providers: [StayService, StaySecretCipher, StayLifecycleWorker],
  exports: [StayService, StayLifecycleWorker],
})
export class StayModule {}
