import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";

import { REDIS_CONNECTION } from "../queue/queue.module";

export type RateLimitDecision = {
  allowed: boolean;
  /** Seconds until the window rolls over. Sent as `Retry-After`. */
  retryAfterSeconds: number;
  remaining: number;
};

/**
 * Fixed-window counters in Redis.
 *
 * Redis rather than process memory because the API is stateless and expected
 * to run more than one instance: a per-process counter would multiply every
 * limit by the number of pods, which is the same as not having one. The
 * counters are the only thing Redis is trusted with here — no answer that
 * matters is read back from it.
 *
 * Fails **open**. A limiter that rejects traffic because its own store is down
 * turns a Redis blip into an outage; brute-force protection is worth less than
 * availability, and the login path has Argon2id underneath it either way.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly prefix: string;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    config: ConfigService,
  ) {
    // Shares the queue's namespace so a test run cannot collide with a dev
    // server pointed at the same Redis.
    this.prefix = `${config.get<string>("BULLMQ_PREFIX") ?? "rezervio"}:rl`;
  }

  /**
   * Counts one hit against `bucket:key` and says whether it may proceed.
   *
   * The window starts with the first hit and the TTL is set in the same round
   * trip, so a counter can never outlive its window and lock somebody out.
   */
  async consume(
    bucket: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision> {
    const redisKey = `${this.prefix}:${bucket}:${key}`;

    try {
      const [count, ttl] = (await this.redis
        .multi()
        .incr(redisKey)
        // NX: only the first hit sets the expiry, so the window does not slide
        // forward with every request and never expire.
        .expire(redisKey, windowSeconds, "NX")
        .ttl(redisKey)
        .exec()
        .then((replies) => [
          Number(replies?.[0]?.[1] ?? 0),
          Number(replies?.[2]?.[1] ?? windowSeconds),
        ])) as [number, number];

      return {
        allowed: count <= limit,
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
        remaining: Math.max(0, limit - count),
      };
    } catch (error) {
      this.logger.warn({
        event: "rate_limit.store_unavailable",
        bucket,
        reason: (error as Error).message,
      });
      return { allowed: true, retryAfterSeconds: 0, remaining: limit };
    }
  }

  /** Clears a counter — a successful login should not stay rate limited. */
  async reset(bucket: string, key: string): Promise<void> {
    await this.redis.del(`${this.prefix}:${bucket}:${key}`).catch(() => 0);
  }
}
