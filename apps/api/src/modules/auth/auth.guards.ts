import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AppError, AppErrorCode } from "../../common/app-error";
import { setContextUserId } from "../../infrastructure/security/request-context";

import type { HostRow, UserRole } from "../../infrastructure/database/schema";
import { HostsService } from "../hosts/hosts.service";
import { SessionsService, type SessionUser } from "./sessions.service";

export type RequestAuth = { user: SessionUser; host: HostRow | null };

type AuthenticatedRequest = FastifyRequest & {
  auth?: RequestAuth;
  cookies?: Record<string, string | undefined>;
};

/** Requires a live session. Populates `request.auth` for the param decorators. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(protected readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[this.sessions.cookieName];
    if (!token) throw new UnauthorizedException("Wymagane zalogowanie.");

    const user = await this.sessions.resolve(token);
    if (!user) throw new UnauthorizedException("Sesja wygasła. Zaloguj się ponownie.");

    request.auth = { user, host: null };
    setContextUserId(user.id);
    return true;
  }
}

/**
 * Everything under /api/host requires both a session and a Host profile.
 * Host identity comes from Session → User → Host, so a client cannot name the
 * Host it wants to act as.
 */
@Injectable()
export class HostGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionsService,
    private readonly hosts: HostsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[this.sessions.cookieName];
    if (!token) throw new UnauthorizedException("Wymagane zalogowanie.");

    const user = await this.sessions.resolve(token);
    if (!user) throw new UnauthorizedException("Sesja wygasła. Zaloguj się ponownie.");

    const host = await this.hosts.findByUserId(user.id);
    if (!host) throw new ForbiddenException("To konto nie ma profilu gospodarza.");

    request.auth = { user, host };
    setContextUserId(user.id);
    return true;
  }
}

/**
 * Staff-only access to `/api/admin/*`.
 *
 * The check is here, in a guard on the server, and not in whether the frontend
 * renders a link: hiding a route is not access control, and an admin API that
 * trusted the UI would be open to anyone who typed the URL
 * (milestone 11 §4, §56).
 *
 * SUPPORT and ADMIN both reach every read and every safe action in this
 * milestone. The distinction is kept in the data so a future action can
 * require ADMIN without a migration, but no action needs it yet — there is no
 * state an admin may set by hand that support may not.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  static readonly ROLES: UserRole[] = ["SUPPORT", "ADMIN"];

  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[this.sessions.cookieName];
    if (!token) throw new UnauthorizedException("Wymagane zalogowanie.");

    const user = await this.sessions.resolve(token);
    if (!user) throw new UnauthorizedException("Sesja wygasła. Zaloguj się ponownie.");

    if (!user.roles.some((role) => AdminGuard.ROLES.includes(role))) {
      // Deliberately identical for a Guest and for a Host: the response must
      // not become a way to enumerate who is staff.
      throw new AppError(
        AppErrorCode.ADMIN_FORBIDDEN,
        "To konto nie ma uprawnień administracyjnych.",
        HttpStatus.FORBIDDEN,
      );
    }

    request.auth = { user, host: null };
    setContextUserId(user.id);
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.auth!.user;
  },
);

export const CurrentHost = createParamDecorator(
  (_data: unknown, context: ExecutionContext): HostRow => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.auth!.host!;
  },
);
