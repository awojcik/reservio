import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { HostCalendarService } from "./host-calendar.service";
import { HostOperationsController } from "./host-operations.controller";
import { HostOperationsService } from "./host-operations.service";

/**
 * Read-side only. It owns no state and issues no commands — accepting or
 * cancelling a Booking still goes through the existing Booking endpoints
 * (milestone 07 §24, §25).
 */
@Module({
  imports: [AuthModule],
  controllers: [HostOperationsController],
  providers: [HostOperationsService, HostCalendarService],
})
export class HostOperationsModule {}
