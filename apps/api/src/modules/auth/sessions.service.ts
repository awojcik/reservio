import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, gt, lt } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import {
  userSessions,
  users,
  type UserRole,
} from "../../infrastructure/database/schema";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_SECONDS = 604_800; // 7 days
/** Writing `last_seen_at` on every request would make each GET a write. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  /** Staff roles, empty for an ordinary account. Never sent to the browser. */
  roles: UserRole[];
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class SessionsService {
  readonly cookieName: string;
  readonly ttlSeconds: number;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    config: ConfigService,
  ) {
    this.cookieName = config.get<string>("SESSION_COOKIE_NAME") ?? "rezervio_session";
    this.ttlSeconds = Number(
      config.get<string>("SESSION_TTL_SECONDS") ?? DEFAULT_TTL_SECONDS,
    );
  }

  /**
   * Returns the raw token exactly once — only its SHA-256 hash is persisted,
   * so a database dump cannot be replayed as a live session.
   */
  async create(userId: string, executor: Executor = this.database.db): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await executor
      .insert(userSessions)
      .values({ userId, tokenHash: hashToken(token), expiresAt });

    return token;
  }

  /** Null for anything that is not a live session: unknown, expired or revoked. */
  async resolve(token: string): Promise<SessionUser | null> {
    const now = new Date();

    const [row] = await this.database.db
      .select({
        sessionId: userSessions.id,
        lastSeenAt: userSessions.lastSeenAt,
        userId: users.id,
        email: users.email,
        roles: users.roles,
      })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(eq(userSessions.tokenHash, hashToken(token)), gt(userSessions.expiresAt, now)))
      .limit(1);

    if (!row) return null;

    const stale =
      row.lastSeenAt === null ||
      now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS;
    if (stale) {
      await this.database.db
        .update(userSessions)
        .set({ lastSeenAt: now })
        .where(eq(userSessions.id, row.sessionId));
    }

    return { id: row.userId, email: row.email, roles: (row.roles ?? []) as UserRole[] };
  }

  /** Idempotent: logging out twice is a success both times (milestone 02 §16). */
  async revoke(token: string): Promise<void> {
    await this.database.db
      .delete(userSessions)
      .where(eq(userSessions.tokenHash, hashToken(token)));
  }

  /** Expired rows carry no authority; clearing them keeps the table honest. */
  async purgeExpired(): Promise<void> {
    await this.database.db
      .delete(userSessions)
      .where(lt(userSessions.expiresAt, new Date()));
  }
}
