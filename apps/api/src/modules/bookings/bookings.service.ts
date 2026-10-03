import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";

import { toDate, toDateOrNull } from "../../common/pg-values";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import {
  bookingEvents,
  bookingHolds,
  bookings,
  properties,
  type ActorType,
  type BookingEventType,
  type BookingRow,
  type BookingStatus,
  type BookingStatusReason,
  type NotificationType,
} from "../../infrastructure/database/schema";
import { OutboxService } from "../../infrastructure/outbox/outbox.service";
import { GuestAccessService } from "./guest-access.service";
import { calculatePriceQuote } from "../../domain/pricing";
import {
  assertCapacity,
  generateBookingReference,
  toBookingAmounts,
} from "../../domain/booking";
import { assertValidRange, type DateRange } from "../../domain/availability";
import {
  acquirePropertyLock,
  rangeLiteral,
  AvailabilityService,
} from "../availability/availability.service";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage";
import { StayScheduleCanceller } from "../stay/stay-schedule.canceller";

/** Raised when a Host tries to answer a request whose deadline has passed. */
export class BookingRequestExpiredError extends ConflictException {
  constructor() {
    super({
      code: "BOOKING_REQUEST_EXPIRED",
      message: "Czas na odpowiedź minął — prośba wygasła.",
    });
  }
}

/** Raised when the Stay stopped being free; the caller turns it into a 409. */
export class PropertyNotAvailableError extends ConflictException {
  constructor() {
    super({
      code: "PROPERTY_NOT_AVAILABLE",
      message: "Ten termin nie jest już dostępny.",
    });
  }
}

/** Raised when a Host tries to book their own Property. */
export class CannotBookOwnPropertyError extends ConflictException {
  constructor() {
    super({
      code: "CANNOT_BOOK_OWN_PROPERTY",
      message: "Nie możesz zarezerwować własnego obiektu.",
    });
  }
}

export type CreateBookingInput = {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guest: { name: string; email: string; phone?: string };
  /**
   * The signed-in account, when there is one. Booking without an account must
   * keep working, so this is optional by design (milestone 06 §2).
   */
  guestUserId?: string | null;
  /** Host profile of the signed-in account, used to refuse self-booking. */
  actingHostId?: string | null;
};

export type BookingWithHold = {
  booking: BookingRow;
  holdExpiresAt: Date | null;
  /**
   * Returned exactly once, on creation, so the Guest who just submitted the
   * form can be given access without waiting for an email.
   */
  guestAccessToken?: string;
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly availability: AvailabilityService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly outbox: OutboxService,
    private readonly guestAccess: GuestAccessService,
    private readonly stayJobs: StayScheduleCanceller,
    private readonly config: ConfigService,
  ) {}

  private get holdTtlSeconds(): number {
    return Number(this.config.get("BOOKING_HOLD_TTL_SECONDS") ?? 600);
  }

  private get requestTtlSeconds(): number {
    return Number(this.config.get("BOOKING_REQUEST_TTL_SECONDS") ?? 86_400);
  }

  /**
   * Appends to the Booking timeline. Audit only — `bookings.status` stays the
   * canonical current state (milestone 05 §38).
   */
  private async recordEvent(
    tx: Executor,
    bookingId: string,
    type: BookingEventType,
    actorType: ActorType,
    actorId?: string | null,
    metadata?: Record<string, string | number | null>,
  ): Promise<void> {
    await tx.insert(bookingEvents).values({
      bookingId,
      type,
      actorType,
      actorId: actorId ?? null,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    });
  }

  /**
   * Queues a notification *inside* the caller's transaction.
   *
   * Writing the intent alongside the state change is what makes the email
   * survive a crash before the queue call (milestone 05 §42, §44).
   */
  private async notify(
    tx: Executor,
    bookingId: string,
    type: NotificationType,
  ): Promise<void> {
    await this.outbox.record(tx, {
      type: "NOTIFICATION",
      aggregateType: "booking",
      aggregateId: bookingId,
      payload: { bookingId, notificationType: type },
    });
  }

  /**
   * Appends to the Booking timeline from another module.
   *
   * Payments live in their own module but write to the same trail: "paid",
   * "confirmed" and "refunded" belong in the history a Guest and a Host read,
   * next to "requested" and "accepted".
   */
  async recordPaymentEvent(
    bookingId: string,
    type: BookingEventType,
    metadata: Record<string, string | number | null> | null,
    executor: Executor = this.database.db,
  ): Promise<void> {
    await this.recordEvent(executor, bookingId, type, "SYSTEM", null, metadata ?? undefined);
  }

  /**
   * Records a non-notification intent on the Booking, in the caller's
   * transaction.
   *
   * Used by connectivity: "this confirmed Booking must be announced to the
   * systems its Property is connected to" is exactly the kind of follow-up the
   * outbox exists for — it must survive a crash right after the commit, and it
   * must not make the commit wait on a third party (milestone 12 §14).
   */
  async recordOutboxIntent(
    executor: Executor,
    bookingId: string,
    type: "EXTERNAL_RESERVATION_PUSH" | "EXTERNAL_RESERVATION_CANCEL",
  ): Promise<void> {
    await this.outbox.record(executor, {
      type,
      aggregateType: "booking",
      aggregateId: bookingId,
      payload: { bookingId },
    });
  }

  /**
   * Queues a Booking notification from another module. Pass the caller's
   * transaction so the intent commits with the state change it describes.
   */
  async notifyBooking(
    bookingId: string,
    type: NotificationType,
    executor: Executor = this.database.db,
  ): Promise<void> {
    await this.notify(executor, bookingId, type);
  }

  /**
   * The Guest-facing entry point. Which flow runs is decided by the Property,
   * never by the request: a client cannot ask to skip Host approval
   * (milestone 04 §20).
   */
  async createBooking(input: CreateBookingInput): Promise<BookingWithHold> {
    const stay: DateRange = { startDate: input.checkIn, endDate: input.checkOut };
    assertValidRange(stay);

    return this.database.db.transaction(async (tx) => {
      // First statement in the transaction: everything read after this is
      // stable until commit, which is what makes the recheck below meaningful.
      await acquirePropertyLock(tx, input.propertyId);

      const [property] = await tx
        .select()
        .from(properties)
        .where(eq(properties.id, input.propertyId))
        .limit(1);

      if (!property || property.status !== "PUBLISHED") {
        throw new NotFoundException("Nie znaleziono obiektu.");
      }

      // Enforced server-side: hiding the button would not stop a direct call
      // (milestone 06 §24).
      if (input.actingHostId && input.actingHostId === property.hostId) {
        throw new CannotBookOwnPropertyError();
      }

      assertCapacity({ adults: input.adults, children: input.children }, property.maxGuests);

      // Never trust availability observed during Search — recheck it here,
      // inside the lock (milestone 04 §19).
      const free = await this.availability.isAvailableWithin(tx, property.id, stay);
      if (!free) {
        this.logger.warn({
          event: "booking.availability_conflict",
          propertyId: property.id,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        });
        throw new PropertyNotAvailableError();
      }

      // The server prices the Stay. A total sent by the browser is ignored.
      const amounts = toBookingAmounts(
        calculatePriceQuote(
          {
            baseDailyRateAmountMinor: property.baseDailyRateAmountMinor,
            cleaningFeeAmountMinor: property.cleaningFeeAmountMinor,
            marketDailyRateAmountMinor: property.marketDailyRateAmountMinor,
            currency: property.currency,
          },
          input.checkIn,
          input.checkOut,
        ),
      );

      const instant = property.bookingMode === "INSTANT_BOOK";

      // A request cannot hang forever. The deadline lives in the row, so the
      // API can tell it has lapsed even if the worker is late (§23).
      const hostResponseDeadlineAt = instant
        ? null
        : new Date(Date.now() + this.requestTtlSeconds * 1000);

      const [booking] = await tx
        .insert(bookings)
        .values({
          hostResponseDeadlineAt,
          publicReference: generateBookingReference(),
          propertyId: property.id,
          hostId: property.hostId,
          bookingMode: property.bookingMode,
          status: instant ? "PENDING_PAYMENT" : "PENDING_HOST_APPROVAL",
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          adults: input.adults,
          children: input.children,
          guestUserId: input.guestUserId ?? null,
          guestName: input.guest.name,
          guestEmail: input.guest.email,
          guestPhone: input.guest.phone ?? null,
          propertyTitleSnapshot: property.title,
          propertyCitySnapshot: property.city || null,
          // Captured now so a trip card still renders after the Property is
          // archived and its photos are gone (milestone 06 §33).
          coverImageUrlSnapshot: await this.coverImageUrl(tx, property.id),
          ...amounts,
        })
        .returning();

      this.logger.log({
        event: instant ? "booking.created" : "booking.requested",
        bookingId: booking.id,
        reference: booking.publicReference,
        propertyId: property.id,
        mode: property.bookingMode,
        totalAmountMinor: amounts.totalAmountMinor,
        currency: amounts.currency,
      });

      await this.recordEvent(tx, booking.id, "BOOKING_CREATED", "GUEST", null, {
        mode: property.bookingMode,
      });

      // Minted in the same transaction: without it the Guest would have no way
      // to open the Booking they just made until an email happened to arrive.
      const guestAccessToken = await this.guestAccess.issue(booking.id, tx);

      if (!instant) {
        // Request-to-book deliberately holds nothing: the calendar must stay
        // open while the Host thinks it over (milestone 04 §22).
        await this.notify(tx, booking.id, "BOOKING_REQUEST_CREATED");
        return { booking, holdExpiresAt: null, guestAccessToken };
      }

      const hold = await this.createHold(tx, booking.id, property.id, stay);
      return { booking, holdExpiresAt: hold.expiresAt, guestAccessToken };
    });
  }

  /**
   * Host approval. Availability is checked again, because the Stay may have
   * been taken while the request was waiting (milestone 04 §25, §26).
   */
  async acceptBookingRequest(hostId: string, bookingId: string): Promise<BookingWithHold> {
    const outcome = await this.database.db.transaction<
      | { conflict: true; bookingId: string; reason: "AVAILABILITY" | "DEADLINE" }
      | ({ conflict: false } & BookingWithHold)
    >(async (tx) => {
      const booking = await this.loadOwned(tx, hostId, bookingId, true);

      // Retrying accept must not mint a second hold (milestone 04 §33).
      if (booking.status === "PENDING_PAYMENT") {
        const [existing] = await tx
          .select()
          .from(bookingHolds)
          .where(eq(bookingHolds.bookingId, booking.id))
          .limit(1);
        return { conflict: false, booking, holdExpiresAt: existing?.expiresAt ?? null };
      }

      if (booking.status !== "PENDING_HOST_APPROVAL") {
        throw new ConflictException("Ta prośba została już rozpatrzona.");
      }

      // The database deadline decides, not the queue. A worker that has not
      // fired yet must never let a lapsed request through (§24).
      if (
        booking.hostResponseDeadlineAt &&
        booking.hostResponseDeadlineAt.getTime() <= Date.now()
      ) {
        return { conflict: true, bookingId: booking.id, reason: "DEADLINE" as const };
      }

      await acquirePropertyLock(tx, booking.propertyId);

      const stay: DateRange = { startDate: booking.checkIn, endDate: booking.checkOut };
      const free = await this.availability.isAvailableWithin(tx, booking.propertyId, stay);

      // Reported back rather than thrown: throwing here would roll the
      // transaction back, and with it the record of *why* the request died.
      // The Booking is marked EXPIRED in its own transaction below (§26).
      if (!free) return { conflict: true, bookingId: booking.id, reason: "AVAILABILITY" as const };

      const hold = await this.createHold(tx, booking.id, booking.propertyId, stay);

      const [updated] = await tx
        .update(bookings)
        .set({
          status: "PENDING_PAYMENT" satisfies BookingStatus,
          hostRespondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id))
        .returning();

      await this.recordEvent(tx, booking.id, "HOST_ACCEPTED", "HOST", hostId);
      await this.recordEvent(tx, booking.id, "HOLD_CREATED", "SYSTEM", null, {
        expiresAt: hold.expiresAt.toISOString(),
      });
      await this.notify(tx, booking.id, "BOOKING_REQUEST_ACCEPTED");

      this.logger.log({
        event: "booking.request.accepted",
        bookingId: booking.id,
        propertyId: booking.propertyId,
        hostId,
      });

      return { conflict: false, booking: updated, holdExpiresAt: hold.expiresAt };
    });

    if (!outcome.conflict) {
      return { booking: outcome.booking, holdExpiresAt: outcome.holdExpiresAt };
    }

    const reason: BookingStatusReason =
      outcome.reason === "DEADLINE" ? "HOST_RESPONSE_TIMEOUT" : "AVAILABILITY_LOST";

    // Separate transaction, so this survives the 409 the Host is about to get.
    await this.database.db.transaction(async (tx) => {
      const [expired] = await tx
        .update(bookings)
        .set({
          status: "EXPIRED" satisfies BookingStatus,
          statusReason: reason,
          expiredAt: new Date(),
          hostRespondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bookings.id, outcome.bookingId),
            eq(bookings.status, "PENDING_HOST_APPROVAL"),
          ),
        )
        .returning();

      if (!expired) return;

      await this.recordEvent(tx, outcome.bookingId, "REQUEST_EXPIRED", "SYSTEM", null, {
        reason,
      });
      await this.notify(tx, outcome.bookingId, "BOOKING_REQUEST_EXPIRED");
    });

    this.logger.warn({
      event:
        outcome.reason === "DEADLINE"
          ? "booking.request.expired"
          : "booking.availability_conflict",
      bookingId: outcome.bookingId,
      hostId,
      stage: "accept",
    });

    if (outcome.reason === "DEADLINE") throw new BookingRequestExpiredError();
    throw new PropertyNotAvailableError();
  }

  /** Retry-safe: rejecting an already rejected request is a no-op, not an error. */
  async rejectBookingRequest(hostId: string, bookingId: string): Promise<BookingRow> {
    return this.database.db.transaction(async (tx) => {
      const booking = await this.loadOwned(tx, hostId, bookingId, true);

      if (booking.status === "CANCELLED") return booking;

      if (booking.status !== "PENDING_HOST_APPROVAL") {
        throw new ConflictException("Ta prośba została już rozpatrzona.");
      }

      const [updated] = await tx
        .update(bookings)
        .set({
          status: "CANCELLED" satisfies BookingStatus,
          statusReason: "HOST_REJECTED",
          cancelledAt: new Date(),
          hostRespondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id))
        .returning();

      await this.recordEvent(tx, booking.id, "HOST_REJECTED", "HOST", hostId);
      await this.notify(tx, booking.id, "BOOKING_REQUEST_REJECTED");

      this.logger.log({
        event: "booking.request.rejected",
        bookingId: booking.id,
        propertyId: booking.propertyId,
        hostId,
      });

      return updated;
    });
  }

  /**
   * Expires one hold and the Booking waiting on it. Idempotent by design: the
   * job may run late, twice, or after the hold was already released
   * (milestone 04 §29).
   */
  async expireBookingHold(holdId: string): Promise<{ expired: boolean }> {
    return this.database.db.transaction(async (tx) => {
      const [hold] = await tx
        .select()
        .from(bookingHolds)
        .where(eq(bookingHolds.id, holdId))
        .limit(1);

      if (!hold || hold.status !== "ACTIVE") return { expired: false };

      // Not due yet — the job fired early; leave everything alone.
      if (hold.expiresAt.getTime() > Date.now()) return { expired: false };

      await acquirePropertyLock(tx, hold.propertyId);

      await tx
        .update(bookingHolds)
        .set({ status: "EXPIRED", expiredAt: new Date() })
        .where(eq(bookingHolds.id, hold.id));

      // The block row goes away with the hold; availability already ignored it
      // the moment it expired, so this is tidying, not correctness.
      await tx.execute(
        sql`DELETE FROM availability_blocks WHERE booking_hold_id = ${hold.id}`,
      );

      await tx
        .update(bookings)
        .set({
          status: "EXPIRED" satisfies BookingStatus,
          statusReason: "HOLD_EXPIRED",
          expiredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(bookings.id, hold.bookingId), eq(bookings.status, "PENDING_PAYMENT")),
        );

      await this.recordEvent(tx, hold.bookingId, "HOLD_EXPIRED", "SYSTEM");

      this.logger.log({
        event: "booking.hold.expired",
        holdId: hold.id,
        bookingId: hold.bookingId,
        propertyId: hold.propertyId,
      });

      return { expired: true };
    });
  }

  /**
   * Expires a Request-to-Book whose deadline has passed.
   *
   * Idempotent: the job may fire late, twice, or after the Host already
   * answered (milestone 05 §22).
   */
  async expireBookingRequest(bookingId: string): Promise<{ expired: boolean }> {
    return this.database.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1)
        .for("update");

      if (!booking || booking.status !== "PENDING_HOST_APPROVAL") return { expired: false };

      // Fired early — leave it alone rather than cutting the Host short.
      if (
        booking.hostResponseDeadlineAt &&
        booking.hostResponseDeadlineAt.getTime() > Date.now()
      ) {
        return { expired: false };
      }

      await tx
        .update(bookings)
        .set({
          status: "EXPIRED" satisfies BookingStatus,
          statusReason: "HOST_RESPONSE_TIMEOUT" satisfies BookingStatusReason,
          expiredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));

      await this.recordEvent(tx, booking.id, "REQUEST_EXPIRED", "SYSTEM");
      await this.notify(tx, booking.id, "BOOKING_REQUEST_EXPIRED");

      this.logger.log({
        event: "booking.request.expired",
        bookingId: booking.id,
        propertyId: booking.propertyId,
      });

      return { expired: true };
    });
  }

  /**
   * Guest-initiated cancellation.
   *
   * For a request there is nothing to release. For a Booking already holding
   * dates the hold and its availability block must go inside the same
   * transaction, under the Property lock, or the calendar would stay blocked
   * by a Booking nobody expects any more (milestone 05 §31).
   */
  async cancelBookingByGuest(bookingId: string): Promise<BookingRow> {
    return this.cancelBooking(bookingId, "GUEST", null, "GUEST_CANCELLED");
  }

  /** Host-initiated cancellation. Ownership is checked by the caller. */
  async cancelBookingByHost(hostId: string, bookingId: string): Promise<BookingRow> {
    await this.loadOwned(this.database.db, hostId, bookingId, false);
    return this.cancelBooking(bookingId, "HOST", hostId, "HOST_CANCELLED");
  }

  private async cancelBooking(
    bookingId: string,
    actor: ActorType,
    actorId: string | null,
    reason: BookingStatusReason,
  ): Promise<BookingRow> {
    return this.database.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1)
        .for("update");

      if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");

      // Retry-safe: cancelling an already cancelled Booking changes nothing.
      if (booking.status === "CANCELLED") return booking;

      if (
        booking.status !== "PENDING_HOST_APPROVAL" &&
        booking.status !== "PENDING_PAYMENT"
      ) {
        throw new ConflictException({
          code: "BOOKING_NOT_CANCELLABLE",
          message: "Tej rezerwacji nie można już anulować.",
        });
      }

      if (booking.status === "PENDING_PAYMENT") {
        await acquirePropertyLock(tx, booking.propertyId);

        const [hold] = await tx
          .select()
          .from(bookingHolds)
          .where(
            and(
              eq(bookingHolds.bookingId, booking.id),
              eq(bookingHolds.status, "ACTIVE"),
            ),
          )
          .limit(1);

        if (hold) {
          await tx
            .update(bookingHolds)
            .set({ status: "RELEASED", releasedAt: new Date() })
            .where(eq(bookingHolds.id, hold.id));
          await tx.execute(
            sql`DELETE FROM availability_blocks WHERE booking_hold_id = ${hold.id}`,
          );

          await this.recordEvent(tx, booking.id, "HOLD_RELEASED", "SYSTEM");
        }
      }

      const [updated] = await tx
        .update(bookings)
        .set({
          status: "CANCELLED" satisfies BookingStatus,
          statusReason: reason,
          cancelledAt: new Date(),
          updatedAt: new Date(),
          ...(actor === "HOST" ? { hostRespondedAt: new Date() } : {}),
        })
        .where(eq(bookings.id, booking.id))
        .returning();

      await this.recordEvent(
        tx,
        booking.id,
        actor === "GUEST" ? "GUEST_CANCELLED" : "HOST_CANCELLED",
        actor,
        actorId,
      );
      // The other side is told, never the person who just clicked cancel.
      await this.notify(
        tx,
        booking.id,
        actor === "GUEST" ? "BOOKING_CANCELLED_BY_GUEST" : "BOOKING_CANCELLED_BY_HOST",
      );

      /*
       * And so are the connected systems, through the same outbox. A Booking
       * that was pushed to a PMS and then cancelled must not go on blocking
       * dates there; one that was never pushed simply has nothing to cancel,
       * which the worker discovers rather than this transaction
       * (milestone 12 §15).
       */
      await this.outbox.record(tx, {
        type: "EXTERNAL_RESERVATION_CANCEL",
        aggregateType: "booking",
        aggregateId: booking.id,
        payload: { bookingId: booking.id },
      });

      this.logger.log({
        event: actor === "GUEST" ? "booking.cancelled.guest" : "booking.cancelled.host",
        bookingId: booking.id,
        propertyId: booking.propertyId,
      });

      return updated;
    })
      .then(async (updated) => {
        // After the commit: the Stay is not happening, so its scheduled
        // reminders should not be sitting in the queue. Best effort — every
        // stay job re-checks the Booking status anyway (milestone 09 §22).
        await this.stayJobs.cancelFor(bookingId);
        return updated;
      });
  }

  /** First photo of the Property at booking time, or null when it has none. */
  private async coverImageUrl(tx: Executor, propertyId: string): Promise<string | null> {
    const rows = (await tx.execute(sql`
      SELECT object_key, url FROM property_images
      WHERE property_id = ${propertyId}
      ORDER BY position ASC
      LIMIT 1
    `)) as unknown as { object_key: string | null; url: string | null }[];

    const cover = rows[0];
    if (!cover) return null;
    return cover.object_key ? this.storage.getPublicUrl(cover.object_key) : cover.url;
  }

  /** The audit trail for one Booking, oldest first. */
  async timelineFor(bookingId: string) {
    return this.database.db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, bookingId))
      .orderBy(bookingEvents.createdAt);
  }

  /** Requests whose deadline has passed but which nobody has expired yet. */
  async findExpiredRequests(): Promise<{ id: string }[]> {
    return this.database.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "PENDING_HOST_APPROVAL"),
          lt(bookings.hostResponseDeadlineAt, new Date()),
        ),
      );
  }

  /** Frees a hold before its TTL, e.g. when a Booking is cancelled. */
  async releaseBookingHold(holdId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [hold] = await tx
        .select()
        .from(bookingHolds)
        .where(eq(bookingHolds.id, holdId))
        .limit(1);

      if (!hold || hold.status !== "ACTIVE") return;

      await acquirePropertyLock(tx, hold.propertyId);

      await tx
        .update(bookingHolds)
        .set({ status: "RELEASED", releasedAt: new Date() })
        .where(eq(bookingHolds.id, hold.id));
      await tx.execute(
        sql`DELETE FROM availability_blocks WHERE booking_hold_id = ${hold.id}`,
      );

      this.logger.log({
        event: "booking.hold.released",
        holdId: hold.id,
        bookingId: hold.bookingId,
      });
    });
  }

  /** Internal lookup by primary key, used by the idempotent replay path. */
  async findByIdInternal(bookingId: string): Promise<BookingRow> {
    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");
    return booking;
  }

  async findByReference(reference: string): Promise<BookingWithHold> {
    const [booking] = await this.database.db
      .select()
      .from(bookings)
      .where(eq(bookings.publicReference, reference))
      .limit(1);

    if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");

    const [hold] = await this.database.db
      .select()
      .from(bookingHolds)
      .where(
        and(eq(bookingHolds.bookingId, booking.id), eq(bookingHolds.status, "ACTIVE")),
      )
      .limit(1);

    return { booking, holdExpiresAt: hold?.expiresAt ?? null };
  }

  /**
   * The Host's Bookings, filtered and searched.
   *
   * Every branch keeps `host_id = :hostId` in the WHERE clause, so no filter
   * combination can widen the result past what this Host owns
   * (milestone 07 §22, §28).
   */
  async listForHost(
    hostId: string,
    filters: {
      status?: string;
      propertyId?: string;
      search?: string;
      from?: string;
      to?: string;
      sort?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ items: BookingRow[]; total: number }> {
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const conditions: SQL[] = [sql`b.host_id = ${hostId}`];

    if (filters.status) conditions.push(sql`b.status = ${filters.status}`);
    if (filters.propertyId) conditions.push(sql`b.property_id = ${filters.propertyId}`);

    // Overlap, not containment: a Stay straddling the window still matters.
    if (filters.from) conditions.push(sql`b.check_out > ${filters.from}::date`);
    if (filters.to) conditions.push(sql`b.check_in < ${filters.to}::date`);

    if (filters.search) {
      const pattern = `%${filters.search.toLowerCase()}%`;
      conditions.push(sql`(
        lower(b.public_reference) LIKE ${pattern}
        OR lower(b.guest_name) LIKE ${pattern}
        OR lower(b.guest_email) LIKE ${pattern}
      )`);
    }

    const where = sql.join(conditions, sql` AND `);

    const rows = (await this.database.db.execute(sql`
      SELECT b.*, count(*) OVER () AS total_count
      FROM bookings b
      WHERE ${where}
      ORDER BY ${this.bookingOrder(filters.sort ?? "NEWEST")}
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as (Record<string, unknown> & { total_count: string | number })[];

    return {
      items: rows.map(toBookingRow),
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    };
  }

  private bookingOrder(sort: string): SQL {
    switch (sort) {
      case "STAY_DATE_ASC":
        return sql`b.check_in ASC, b.created_at DESC`;
      case "STAY_DATE_DESC":
        return sql`b.check_in DESC, b.created_at DESC`;
      case "ACTION_REQUIRED":
        // Requests awaiting a decision first, soonest deadline at the top.
        return sql`
          CASE b.status
            WHEN 'PENDING_HOST_APPROVAL' THEN 0
            WHEN 'PENDING_PAYMENT' THEN 1
            ELSE 2
          END ASC,
          b.host_response_deadline_at ASC NULLS LAST,
          b.created_at DESC
        `;
      default:
        return sql`b.created_at DESC`;
    }
  }

  async findForHost(hostId: string, bookingId: string): Promise<BookingWithHold> {
    const booking = await this.loadOwned(this.database.db, hostId, bookingId, false);

    const [hold] = await this.database.db
      .select()
      .from(bookingHolds)
      .where(
        and(eq(bookingHolds.bookingId, booking.id), eq(bookingHolds.status, "ACTIVE")),
      )
      .limit(1);

    return { booking, holdExpiresAt: hold?.expiresAt ?? null };
  }

  /**
   * Confirmed Bookings of a Property whose Stay has not finished yet.
   *
   * Used when a Host edits the check-in time or a notification offset: the
   * already-scheduled jobs describe the old configuration and have to be
   * rebuilt (milestone 09 §22).
   */
  async upcomingConfirmedIds(propertyId: string): Promise<string[]> {
    const today = new Date().toISOString().slice(0, 10);

    const rows = await this.database.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          eq(bookings.status, "CONFIRMED"),
          gte(bookings.checkOut, today),
        ),
      );

    return rows.map((row) => row.id);
  }

  /**
   * Active holds for many Bookings at once — the list view would otherwise
   * fire one query per row (milestone 07 §21).
   */
  async activeHoldsFor(bookingIds: string[]): Promise<Map<string, Date>> {
    if (bookingIds.length === 0) return new Map();

    const rows = await this.database.db
      .select({ bookingId: bookingHolds.bookingId, expiresAt: bookingHolds.expiresAt })
      .from(bookingHolds)
      .where(
        and(
          inArray(bookingHolds.bookingId, bookingIds),
          eq(bookingHolds.status, "ACTIVE"),
        ),
      );

    return new Map(rows.map((row) => [row.bookingId, row.expiresAt]));
  }

  /** Also used by the worker to find the hold it must schedule expiry for. */
  async findActiveHold(bookingId: string) {
    const [hold] = await this.database.db
      .select()
      .from(bookingHolds)
      .where(and(eq(bookingHolds.bookingId, bookingId), eq(bookingHolds.status, "ACTIVE")))
      .limit(1);
    return hold ?? null;
  }

  /**
   * Creates the hold and the availability block that gives it teeth, inside
   * the caller's transaction and under its Property lock.
   */
  private async createHold(
    tx: Executor,
    bookingId: string,
    propertyId: string,
    stay: DateRange,
  ) {
    const expiresAt = new Date(Date.now() + this.holdTtlSeconds * 1000);

    const [hold] = await tx
      .insert(bookingHolds)
      .values({
        bookingId,
        propertyId,
        dateRange: sql`${rangeLiteral(stay)}` as unknown as string,
        status: "ACTIVE",
        expiresAt,
      })
      .returning();

    await tx.execute(sql`
      INSERT INTO availability_blocks (property_id, source_type, date_range, booking_hold_id)
      VALUES (${propertyId}, 'BOOKING_HOLD', ${rangeLiteral(stay)}, ${hold.id})
    `);

    this.logger.log({
      event: "booking.hold.created",
      holdId: hold.id,
      bookingId,
      propertyId,
      expiresAt: expiresAt.toISOString(),
    });

    return hold;
  }

  /** A Booking belonging to another Host answers 404, never 403. */
  private async loadOwned(
    executor: Executor,
    hostId: string,
    bookingId: string,
    forUpdate: boolean,
  ): Promise<BookingRow> {
    // Through the query builder rather than raw SQL: `execute` hands back
    // snake_case rows, which would not match BookingRow.
    const query = executor
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, hostId)))
      .limit(1);

    const rows = forUpdate ? await query.for("update") : await query;

    const booking = rows[0];
    if (!booking) throw new NotFoundException("Nie znaleziono rezerwacji.");
    return booking;
  }
}

/**
 * `execute` returns snake_case rows, so a raw query needs mapping back onto
 * the shape the rest of the code expects.
 */
function toBookingRow(row: Record<string, unknown>): BookingRow {
  return {
    id: row.id as string,
    publicReference: row.public_reference as string,
    propertyId: row.property_id as string,
    hostId: row.host_id as string,
    bookingMode: row.booking_mode as string,
    status: row.status as string,
    statusReason: (row.status_reason ?? null) as string | null,
    checkIn: row.check_in as string,
    checkOut: row.check_out as string,
    adults: row.adults as number,
    children: row.children as number,
    guestUserId: (row.guest_user_id ?? null) as string | null,
    guestName: row.guest_name as string,
    guestEmail: row.guest_email as string,
    guestPhone: (row.guest_phone ?? null) as string | null,
    propertyTitleSnapshot: row.property_title_snapshot as string,
    propertyCitySnapshot: (row.property_city_snapshot ?? null) as string | null,
    coverImageUrlSnapshot: (row.cover_image_url_snapshot ?? null) as string | null,
    accommodationAmountMinor: row.accommodation_amount_minor as number,
    cleaningFeeAmountMinor: row.cleaning_fee_amount_minor as number,
    serviceFeeAmountMinor: row.service_fee_amount_minor as number,
    taxAmountMinor: row.tax_amount_minor as number,
    discountAmountMinor: row.discount_amount_minor as number,
    totalAmountMinor: row.total_amount_minor as number,
    currency: row.currency as string,
    hostResponseDeadlineAt: toDateOrNull(row.host_response_deadline_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    hostRespondedAt: toDateOrNull(row.host_responded_at),
    cancelledAt: toDateOrNull(row.cancelled_at),
    expiredAt: toDateOrNull(row.expired_at),
    confirmedAt: toDateOrNull(row.confirmed_at),
    sensitiveAccessRevealedAt: toDateOrNull(row.sensitive_access_revealed_at),
  };
}
