import { Module } from "@nestjs/common";

import { OutboxModule } from "../../infrastructure/outbox/outbox.module";
import { GuestAccessModule } from "../bookings/guest-access.module";
import { NotificationWorker } from "./application/notification.worker";
import { NotificationsService } from "./application/notifications.service";
import { EMAIL_PROVIDER } from "./infrastructure/email-provider";
import { SmtpEmailProvider } from "./infrastructure/smtp-email-provider";

@Module({
  imports: [GuestAccessModule, OutboxModule],
  providers: [
    NotificationsService,
    NotificationWorker,
    SmtpEmailProvider,
    { provide: EMAIL_PROVIDER, useExisting: SmtpEmailProvider },
  ],
  exports: [NotificationsService, NotificationWorker],
})
export class NotificationsModule {}
