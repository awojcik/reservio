import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BookingsModule } from "../bookings/bookings.module";
import { PaymentProviderModule } from "../payments/payment-provider.module";
import { StayModule } from "../stay/stay.module";
import { HostSettlementsController } from "./host-settlements.controller";
import { SettlementWorker } from "./settlement.worker";
import { SettlementsService } from "./settlements.service";

/**
 * What the Host is owed, and how it reaches them.
 *
 * Four distinct things live here and are never conflated: the Settlement (how
 * much), its release (from when), the Transfer (platform → connected account)
 * and the Payout (connected account → bank), which the provider makes and we
 * only observe.
 */
@Module({
  imports: [AuthModule, BookingsModule, StayModule, PaymentProviderModule],
  controllers: [HostSettlementsController],
  providers: [SettlementsService, SettlementWorker],
  exports: [SettlementsService, SettlementWorker],
})
export class SettlementsModule {}
