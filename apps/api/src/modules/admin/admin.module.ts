import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CalendarsModule } from "../calendars/calendars.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentProviderModule } from "../payments/payment-provider.module";
import { PaymentsModule } from "../payments/payments.module";
import { ConnectivityModule } from "../connectivity/connectivity.module";
import { SettlementsModule } from "../settlements/settlements.module";
import { AdminActionsController } from "./admin-actions.controller";
import { AdminActionsService } from "./admin-actions.service";
import { AdminController } from "./admin.controller";
import { AdminJobsService } from "./admin-jobs.service";
import { AdminReadService } from "./admin-read.service";
import { AdminSearchService } from "./admin-search.service";
import { OperationalIssuesService } from "./operational-issues.service";

/**
 * Admin and support.
 *
 * Depends on the domain modules but is depended on by none of them, which is
 * what keeps the arrow pointing one way: the panel reads the domain and calls
 * its commands, and the domain never learns that a panel exists.
 *
 * Nothing here defines a new way to change state. The imports below are
 * exactly the commands an operator is allowed to re-run — a notification, a
 * refund, a transfer, a calendar sync, a Connect refresh and the reconciliation
 * sweep (milestone 11 §9).
 */
@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PaymentsModule,
    PaymentProviderModule,
    SettlementsModule,
    CalendarsModule,
    ConnectivityModule,
  ],
  controllers: [AdminController, AdminActionsController],
  providers: [
    AdminReadService,
    AdminSearchService,
    AdminJobsService,
    AdminActionsService,
    OperationalIssuesService,
  ],
})
export class AdminModule {}
