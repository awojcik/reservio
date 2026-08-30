import { Module } from "@nestjs/common";

import { HostsModule } from "../hosts/hosts.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { SessionGuard, HostGuard } from "./auth.guards";
import { AuthService } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [UsersModule, HostsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionsService,
    LoginRateLimiter,
    SessionGuard,
    HostGuard,
  ],
  // The Host endpoints live in another module but reuse the same guards. A
  // guard is instantiated in the injector of the module that applies it, so
  // HostsModule is re-exported alongside them — otherwise HostGuard could not
  // resolve HostsService there.
  exports: [SessionsService, SessionGuard, HostGuard, HostsModule],
})
export class AuthModule {}
