import { Injectable } from "@nestjs/common";

/** How long a bucket remembers a failure. */
const WINDOW_MS = 15 * 60 * 1000;
/** Failures against one email address before it goes into cooldown. */
const MAX_PER_IDENTIFIER = 10;
/** Failures from one address across *any* accounts. Password spraying. */
const MAX_PER_IP = 30;
/** How long a tripped bucket stays tripped. */
const COOLDOWN_MS = 15 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

/**
 * Brute-force protection for the login endpoint.
 *
 * Two dimensions, because they describe two different attacks and neither
 * catches the other: many guesses against one account, and a few guesses
 * against many accounts from one address (milestone 11 §21).
 *
 * Only *failures* are counted. Counting every attempt would punish a shared
 * office address for signing in successfully, and success is not the thing
 * worth limiting.
 *
 * Deliberately in-process, unlike the Redis-backed limiter on the route: this
 * is the last, cheapest line and it must keep working when Redis does not.
 * Per-instance is a weaker guarantee, and an acceptable one — the real
 * protection is Argon2id plus the uniform "wrong email or password" response,
 * which never reveals whether the account exists.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly identifiers = new Map<string, Bucket>();
  private readonly addresses = new Map<string, Bucket>();

  /** True when this attempt must be refused without checking the password. */
  blocked(email: string, ip: string): boolean {
    return (
      this.tripped(this.identifiers, email, MAX_PER_IDENTIFIER) ||
      this.tripped(this.addresses, ip, MAX_PER_IP)
    );
  }

  recordFailure(email: string, ip: string): void {
    this.bump(this.identifiers, email);
    this.bump(this.addresses, ip);
  }

  /**
   * A correct password clears the account's own bucket, so somebody who
   * mistyped their password four times is not locked out of their own account
   * once they get it right. The address bucket is deliberately left alone: one
   * success does not excuse thirty failures from the same place.
   */
  reset(email: string): void {
    this.identifiers.delete(email);
  }

  private tripped(buckets: Map<string, Bucket>, key: string, max: number): boolean {
    const entry = buckets.get(key);
    if (!entry) return false;
    if (entry.resetAt <= Date.now()) {
      buckets.delete(key);
      return false;
    }
    return entry.count >= max;
  }

  private bump(buckets: Map<string, Bucket>, key: string): void {
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      this.sweep(buckets, now);
      return;
    }

    entry.count += 1;
    // Reaching the limit starts the cooldown from *now*, so a persistent
    // attacker cannot let the original window lapse while still guessing.
    if (entry.count === MAX_PER_IDENTIFIER || entry.count === MAX_PER_IP) {
      entry.resetAt = now + COOLDOWN_MS;
    }
  }

  private sweep(buckets: Map<string, Bucket>, now: number): void {
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }
}
