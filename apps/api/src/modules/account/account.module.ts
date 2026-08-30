import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GuestAccessModule } from "../bookings/guest-access.module";
import { HostsModule } from "../hosts/hosts.module";
import { UsersModule } from "../users/users.module";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";

@Module({
  imports: [AuthModule, UsersModule, HostsModule, GuestAccessModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
