import { createHash } from "node:crypto";

import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, lt } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { idempotencyKeys } from "../../infrastructure/database/schema";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const codes = [
    (error as { code?: string }).code,
    ((error as { cause?: { code?: string } }).cause ?? {}).code,
  ];
  return codes.includes(UNIQUE_VIOLATION);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Makes a command safe to retry.
 *
 * PostgreSQL is the canonical store, not Redis: a retried booking request must
 * not create a second Booking even if the cache is cold or gone
 * (milestone 04 §31).
 *
 * Only hashes are stored — never the Guest's request body, which holds their
 * name, email and phone.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly config: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    return Number(this.config.get("BOOKING_IDEMPOTENCY_TTL_SECONDS") ?? 86_400);
  }

  /**
   * Returns the resource this key already produced, or null when the key is
   * new. A known key replayed with a different payload is a conflict: the
   * client is reusing a key for a different request.
   */
  async lookup(
    scope: string,
    key: string,
    payload: unknown,
  ): Promise<{ resourceId: string } | null> {
    const [existing] = await this.database.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.keyHash, sha256(key))),
      )
      .limit(1);

    if (!existing) return null;

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.database.db
        .delete(idempotencyKeys)
        .where(eq(idempotencyKeys.id, existing.id));
      return null;
    }

    if (existing.requestHash !== sha256(JSON.stringify(payload))) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "Ten klucz idempotencji został już użyty z innymi danymi.",
      });
    }

    return { resourceId: existing.resourceId };
  }

  /**
   * Records the outcome. A concurrent duplicate loses the unique index race and
   * is told which resource won, so both callers end up with the same answer.
   */
  async remember(
    scope: string,
    key: string,
    payload: unknown,
    resource: { type: string; id: string },
  ): Promise<{ storedId: string }> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    try {
      await this.database.db.insert(idempotencyKeys).values({
        scope,
        keyHash: sha256(key),
        requestHash: sha256(JSON.stringify(payload)),
        resourceType: resource.type,
        resourceId: resource.id,
        expiresAt,
      });
      return { storedId: resource.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const winner = await this.lookup(scope, key, payload);
      return { storedId: winner?.resourceId ?? resource.id };
    }
  }

  /** Housekeeping for keys nobody will replay any more. */
  async purgeExpired(): Promise<void> {
    await this.database.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()));
  }
}
