import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  bookings,
  properties,
  type BookingRow,
  type BookingStatus,
} from "../../infrastructure/database/schema";
import { categorise, type TripCategory } from "../../domain/trip-category";
import { today } from "../../domain/availability";
import { GuestAccessService } from "../bookings/guest-access.service";
import { UsersService } from "../users/users.service";
import { HostsService } from "../hosts/hosts.service";
import type { ProfileDto, UpdateProfileDto } from "./dto/account.dto";

export class BookingAlreadyClaimedError extends ConflictException {
  constructor() {
    super({
      code: "BOOKING_ALREADY_CLAIMED",
      message: "Ta rezerwacja jest już przypisana do innego konta.",
    });
  }
}

export class BookingEmailMismatchError extends ConflictException {
  constructor() {
    super({
      code: "BOOKING_EMAIL_MISMATCH",
      message:
        "Rezerwacja została złożona na inny adres email niż ten, na który jesteś zalogowany.",
    });
  }
}

export type TripRow = BookingRow & {
  category: TripCategory;
  propertySlug: string | null;
};

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly users: UsersService,
    private readonly hosts: HostsService,
    private readonly guestAccess: GuestAccessService,
  ) {}

  async profile(userId: string): Promise<ProfileDto> {
    const [user, host] = await Promise.all([
      this.users.findById(userId),
      this.hosts.findByUserId(userId),
    ]);

    if (!user) throw new NotFoundException("Nie znaleziono konta.");

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      preferredLocale: user.preferredLocale,
      isHost: Boolean(host),
    };
  }

  /**
   * Updates the profile only. Historical Bookings keep the details they were
   * made with — a snapshot is not a stale copy of the profile, it is the
   * record of what was agreed (milestone 06 §15).
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileDto> {
    await this.users.updateProfile(userId, {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName || null } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName || null } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
      ...(dto.preferredLocale !== undefined
        ? { preferredLocale: dto.preferredLocale || null }
        : {}),
    });

    return this.profile(userId);
  }

  /**
   * My Trips, read by account rather than by email (milestone 06 §28).
   *
   * Keyset pagination on `(created_at, id)`: a cursor stays correct even as
   * new Bookings arrive, which an offset would not.
   */
  async trips(
    userId: string,
    options: { category?: string; limit?: number; cursor?: string },
  ): Promise<{ items: TripRow[]; nextCursor: string | null }> {
    const limit = options.limit ?? 20;
    const conditions = [eq(bookings.guestUserId, userId)];

    if (options.cursor) {
      const decoded = decodeCursor(options.cursor);
      if (decoded) {
        conditions.push(
          or(
            lt(bookings.createdAt, decoded.createdAt),
            and(eq(bookings.createdAt, decoded.createdAt), lt(bookings.id, decoded.id))!,
          )!,
        );
      }
    }

    if (options.category) {
      const statuses = statusesFor(options.category as TripCategory);
      if (statuses.length > 0) {
        conditions.push(
          sql`${bookings.status} IN (${sql.join(
            statuses.map((status) => sql`${status}`),
            sql`, `,
          )})`,
        );
      }
    }

    // One extra row tells us whether another page exists.
    const rows = await this.database.db
      .select({ booking: bookings, slug: properties.slug, status: properties.status })
      .from(bookings)
      .leftJoin(properties, eq(properties.id, bookings.propertyId))
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt), desc(bookings.id))
      .limit(limit + 1);

    const now = today("Europe/Warsaw");

    let items = rows.slice(0, limit).map((row) => ({
      ...row.booking,
      // A delisted Property has no public page to link to, but the trip is
      // still readable from its snapshot (milestone 06 §33).
      propertySlug: row.status === "PUBLISHED" ? row.slug : null,
      category: categorise(row.booking.status as BookingStatus, row.booking.checkOut, now),
    }));

    // UPCOMING and PAST split on a date, so they cannot be filtered in SQL by
    // status alone; the narrowing happens here, after categorisation.
    if (options.category === "UPCOMING" || options.category === "PAST") {
      items = items.filter((item) => item.category === options.category);
    }

    const hasMore = rows.length > limit && items.length > 0;
    const last = items[items.length - 1];

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** One trip, readable only by the account that owns it. */
  async trip(userId: string, reference: string): Promise<TripRow> {
    const [row] = await this.database.db
      .select({ booking: bookings, slug: properties.slug, status: properties.status })
      .from(bookings)
      .leftJoin(properties, eq(properties.id, bookings.propertyId))
      .where(
        and(
          eq(bookings.publicReference, reference),
          eq(bookings.guestUserId, userId),
        ),
      )
      .limit(1);

    // Somebody else's Booking answers 404, never 403 (milestone 06 §38).
    if (!row) throw new NotFoundException("Nie znaleziono rezerwacji.");

    return {
      ...row.booking,
      propertySlug: row.status === "PUBLISHED" ? row.slug : null,
      category: categorise(
        row.booking.status as BookingStatus,
        row.booking.checkOut,
        today("Europe/Warsaw"),
      ),
    };
  }

  /**
   * Attaches an anonymous Booking to the signed-in account.
   *
   * Three things must line up: a signed-in User, a *valid Guest access token*
   * for this Booking, and a matching email. The token is what proves the
   * claimant is the person who made the Booking — an email address alone is
   * public knowledge and a reference is printed in emails, so neither can
   * authorise this (milestone 06 §17, §18).
   */
  async claim(
    userId: string,
    userEmail: string,
    reference: string,
    guestToken: string,
  ): Promise<TripRow> {
    // Throws unless the token really belongs to this Booking.
    const bookingId = await this.guestAccess.verify(reference, guestToken);

    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");

    // Idempotent: claiming what you already own changes nothing.
    if (booking.guestUserId === userId) return this.trip(userId, reference);

    if (booking.guestUserId && booking.guestUserId !== userId) {
      throw new BookingAlreadyClaimedError();
    }

    if (booking.guestEmail.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
      throw new BookingEmailMismatchError();
    }

    await this.database.db
      .update(bookings)
      .set({ guestUserId: userId, updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), sql`${bookings.guestUserId} IS NULL`));

    this.logger.log({ event: "booking.claimed", bookingId, userId });

    return this.trip(userId, reference);
  }
}

function statusesFor(category: TripCategory): BookingStatus[] {
  switch (category) {
    case "PENDING":
      return ["PENDING_HOST_APPROVAL", "PENDING_PAYMENT"];
    case "CANCELLED":
      return ["CANCELLED", "EXPIRED"];
    // UPCOMING and PAST share the same statuses and are split by date.
    default:
      return ["CONFIRMED", "COMPLETED"];
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
