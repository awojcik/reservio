import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AppErrorCode } from "../../common/app-error";
import { RateLimiterService } from "./rate-limiter.service";

/**
 * How a bucket is keyed.
 *
 * `ip` is the only signal an anonymous endpoint has. Everything a signed-in
 * caller does is keyed by that caller instead: one office behind one NAT must
 * not be able to lock out its own colleagues, and an authenticated abuser is
 * identified better by their session than by their address.
 */
export type RateLimitScope = "ip" | "user" | "user+ip" | "route-param";

export type RateLimitRule = {
  /** Namespace of the counter — one bucket per protected flow. */
  bucket: string;
  limit: number;
  windowSeconds: number;
  scope: RateLimitScope;
  /** Route parameter to key on, for `route-param`. */
  param?: string;
};

export const RATE_LIMIT_KEY = "rezervio:rate-limit";

/**
 * Declares the limit on a handler. The numbers are defaults: each bucket can
 * be re-tuned with `RATE_LIMIT_<BUCKET>_MAX` / `_WINDOW` without a deploy,
 * which is also how the test suite gives itself room where it is not the limit
 * under test.
 */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

type KeyedRequest = FastifyRequest & {
  auth?: { user?: { id?: string } };
  params?: Record<string, string>;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<KeyedRequest>();
    const decision = await this.limiter.consume(
      rule.bucket,
      this.keyFor(rule, request),
      this.numberFor(rule.bucket, "MAX", rule.limit),
      this.numberFor(rule.bucket, "WINDOW", rule.windowSeconds),
    );

    if (decision.allowed) return true;

    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header("retry-after", String(decision.retryAfterSeconds));

    throw new HttpException(
      {
        code: AppErrorCode.RATE_LIMITED,
        message: "Zbyt wiele żądań. Spróbuj ponownie za chwilę.",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private keyFor(rule: RateLimitRule, request: KeyedRequest): string {
    const ip = request.ip ?? "unknown";
    const userId = request.auth?.user?.id;

    switch (rule.scope) {
      case "user":
        // Falls back to the address when the guard runs before authentication.
        return userId ?? `ip:${ip}`;
      case "user+ip":
        return `${userId ?? "anon"}:${ip}`;
      case "route-param":
        return `${request.params?.[rule.param ?? "id"] ?? "none"}:${ip}`;
      default:
        return ip;
    }
  }

  private numberFor(bucket: string, suffix: string, fallback: number): number {
    const name = `RATE_LIMIT_${bucket.replace(/-/g, "_").toUpperCase()}_${suffix}`;
    const raw = Number(this.config.get<string>(name));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }
}
