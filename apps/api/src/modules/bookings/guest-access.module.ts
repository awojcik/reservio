import { Module } from "@nestjs/common";

import { GuestAccessService } from "./guest-access.service";

/**
 * Its own module because both sides need it and neither should depend on the
 * other: Bookings issues tokens, Notifications puts them in emails.
 */
@Module({
  providers: [GuestAccessService],
  exports: [GuestAccessService],
})
export class GuestAccessModule {}
