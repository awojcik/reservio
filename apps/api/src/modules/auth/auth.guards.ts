import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { HostRow } from "../../infrastructure/database/schema";
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
