import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import { bookingGuestAccessTokens, bookings } from "../../infrastructure/database/schema";

const TOKEN_BYTES = 32;

/**
 * Short-lived cookie holding the Guest access token, so the secret leaves the
 * URL after the first visit and does not sit in browser history or a Referer
 * header (milestone 05 §16).
 */
export const GUEST_COOKIE = "rezervio_booking_access";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** A request that has been through @fastify/cookie. */
export type CookieRequest = {
  query?: unknown;
  cookies?: Record<string, string | undefined>;
};

/** The token from the cookie, or from the link the Guest just followed. */
export function guestTokenFrom(request: CookieRequest): string | undefined {
  const query = (request.query ?? {}) as { token?: string };
  return query.token ?? request.cookies?.[GUEST_COOKIE];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * How a Guest proves a Booking is theirs, without an account.
 *
 * The public reference is printed in emails and read out over the phone, so it
 * identifies a Booking but authorises nothing. This token is the secret: 32
 * random bytes, stored only as a hash, revocable, and never logged
 * (milestone 05 §15, §66).
 */
@Injectable()
export class GuestAccessService {
  private readonly logger = new Logger(GuestAccessService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Mints a token and returns the raw value exactly once. */
  async issue(bookingId: string, executor: Executor = this.database.db): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");

    await executor.insert(bookingGuestAccessTokens).values({
      bookingId,
      tokenHash: hashToken(token),
    });

    this.logger.log({ event: "guest_access.created", bookingId });
    return token;
  }

  /**
   * A fresh token for an outgoing email.
   *
   * Existing tokens are deliberately left alone. Only the hash is stored, so
   * an earlier one cannot be recovered and reused in a new message — but
   * revoking it would log the Guest out of the very Booking they are being
   * emailed about. Every token stays valid until the Booking is cancelled or
   * the tokens are revoked explicitly.
   */
  async buildAccessUrl(
    bookingId: string,
    reference: string,
    baseUrl: string,
  ): Promise<string | undefined> {
    const token = await this.issue(bookingId);
    return `${baseUrl}/booking/status/${reference}?token=${token}`;
  }

  /**
   * Verifies a raw token against a Booking.
   *
   * Lookup is by hash, which is already constant-time enough at the index
   * level; the explicit comparison below guards the final check against timing
   * analysis.
   */
  async verify(reference: string, token: string): Promise<string> {
    const tokenHash = hashToken(token);

    const [row] = await this.database.db
      .select({
        tokenId: bookingGuestAccessTokens.id,
        storedHash: bookingGuestAccessTokens.tokenHash,
        bookingId: bookings.id,
        expiresAt: bookingGuestAccessTokens.expiresAt,
      })
      .from(bookingGuestAccessTokens)
      .innerJoin(bookings, eq(bookings.id, bookingGuestAccessTokens.bookingId))
      .where(
        and(
          eq(bookingGuestAccessTokens.tokenHash, tokenHash),
          eq(bookings.publicReference, reference),
          isNull(bookingGuestAccessTokens.revokedAt),
        ),
      )
      .limit(1);

    // Unknown, revoked, or belonging to a different Booking — all the same
    // answer, so nothing can be probed.
    if (!row) throw new UnauthorizedException("Nieprawidłowy link do rezerwacji.");

    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Link do rezerwacji wygasł.");
    }

    const provided = Buffer.from(tokenHash);
    const stored = Buffer.from(row.storedHash);
    if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
      throw new UnauthorizedException("Nieprawidłowy link do rezerwacji.");
    }

    await this.database.db
      .update(bookingGuestAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(bookingGuestAccessTokens.id, row.tokenId));

    this.logger.log({ event: "guest_access.used", bookingId: row.bookingId });
    return row.bookingId;
  }

  async revokeAll(bookingId: string): Promise<void> {
    await this.database.db
      .update(bookingGuestAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(bookingGuestAccessTokens.bookingId, bookingId),
          isNull(bookingGuestAccessTokens.revokedAt),
        ),
      );
  }
}
