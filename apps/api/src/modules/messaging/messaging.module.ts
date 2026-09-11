import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BookingsModule } from "../bookings/bookings.module";
import { GuestAccessModule } from "../bookings/guest-access.module";
import { StayModule } from "../stay/stay.module";
import { GuestStayController } from "./guest-messaging.controller";
import { HostMessagingController } from "./host-messaging.controller";
import { MessagingService } from "./messaging.service";

/**
 * Guest ↔ Host conversation, always inside one Booking. There is deliberately
 * no global messenger: without a Booking there is nothing to discuss and
 * nobody is authorised (milestone 09 §24).
 */
@Module({
  imports: [AuthModule, BookingsModule, GuestAccessModule, StayModule],
  controllers: [GuestStayController, HostMessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
