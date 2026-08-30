import { Injectable } from "@nestjs/common";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/**
 * Deliberately in-process: Redis is out of scope for this milestone, and a
 * per-instance limiter still blunts credential stuffing against a single API.
 * It is a speed bump, not an authorisation boundary — the real protection is
 * Argon2id plus the uniform "wrong email or password" response.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  /** True when the caller may proceed. Counts the attempt as it goes. */
  consume(key: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
      this.sweep(now);
      return true;
    }

    entry.count += 1;
    return entry.count <= MAX_ATTEMPTS;
  }

  /** A successful login should not leave the account rate-limited. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) this.attempts.delete(key);
    }
  }
}
