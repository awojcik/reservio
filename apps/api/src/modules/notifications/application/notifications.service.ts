import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  bookings,
  hosts,
  notificationDeliveries,
  propertyStayInformation,
  users,
  type NotificationType,
} from "../../../infrastructure/database/schema";
import {
  NOTIFICATION_RECIPIENTS,
  PermanentEmailError,
  dedupKeyFor,
} from "../domain/notification";
import { EMAIL_PROVIDER, type EmailProvider } from "../infrastructure/email-provider";
import { renderBookingEmail } from "../templates/booking-emails";
import { GuestAccessService } from "../../bookings/guest-access.service";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const codes = [
    (error as { code?: string }).code,
    ((error as { cause?: { code?: string } }).cause ?? {}).code,
  ];
  return codes.includes(UNIQUE_VIOLATION);
}

export type DeliveryOutcome = "SENT" | "ALREADY_SENT" | "FAILED";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly guestAccess: GuestAccessService,
    private readonly config: ConfigService,
  ) {}

  private get appBaseUrl(): string {
    return (this.config.get<string>("APP_BASE_URL") ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
  }

  /**
   * Sends one logical notification, at most once.
   *
   * `notification_deliveries.dedup_key` is unique, so claiming the row *is* the
   * permission to send. A retried job, a replayed outbox row and a duplicate
   * enqueue all compute the same key and only the first gets through
   * (milestone 05 §12).
   */
  async deliver(
    bookingId: string,
    type: NotificationType,
    refId: string | null = null,
  ): Promise<DeliveryOutcome> {
    const dedupKey = dedupKeyFor(type, bookingId, refId);

    const context = await this.loadContext(bookingId, type);
    if (!context) {
      this.logger.warn({ event: "notification.skipped", bookingId, type, reason: "NO_CONTEXT" });
      return "FAILED";
    }

    const claim = await this.claim(bookingId, type, context.recipient, dedupKey);
    if (claim === "ALREADY_SENT") {
      this.logger.log({ event: "notification.deduped", bookingId, type });
      return "ALREADY_SENT";
    }

    const message = renderBookingEmail(type, context.email);
    message.to = context.recipient;

    try {
      await this.email.send(message);
    } catch (error) {
      const permanent = error instanceof PermanentEmailError;

      await this.database.db
        .update(notificationDeliveries)
        .set({
          status: permanent ? "FAILED" : "PENDING",
          lastErrorCode: (error as { code?: string }).code ?? "UNKNOWN",
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.dedupKey, dedupKey));

      this.logger.warn({
        event: "notification.failed",
        bookingId,
        type,
        errorCode: (error as { code?: string }).code ?? "UNKNOWN",
        permanent,
      });

      // Permanent failures are recorded and dropped; temporary ones bubble up
      // so BullMQ retries with backoff.
      if (permanent) return "FAILED";
      throw error;
    }

    await this.database.db
      .update(notificationDeliveries)
      .set({ status: "SENT", sentAt: new Date(), lastErrorCode: null, updatedAt: new Date() })
      .where(eq(notificationDeliveries.dedupKey, dedupKey));

    // The recipient address is deliberately absent from this line (§65).
    this.logger.log({ event: "notification.sent", bookingId, type });
    return "SENT";
  }

  /**
   * Reserves the right to send. Returns ALREADY_SENT when another attempt
   * already delivered this notification.
   */
  private async claim(
    bookingId: string,
    type: NotificationType,
    recipient: string,
    dedupKey: string,
  ): Promise<"CLAIMED" | "ALREADY_SENT"> {
    try {
      await this.database.db.insert(notificationDeliveries).values({
        bookingId,
        type,
        recipientType: NOTIFICATION_RECIPIENTS[type],
        recipientAddress: recipient,
        status: "PENDING",
        dedupKey,
        attemptCount: 1,
      });
      return "CLAIMED";
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const [existing] = await this.database.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.dedupKey, dedupKey))
        .limit(1);

      // Already delivered, or written off as undeliverable — either way, done.
      if (existing?.status === "SENT" || existing?.status === "FAILED") {
        return "ALREADY_SENT";
      }

      await this.database.db
        .update(notificationDeliveries)
        .set({ attemptCount: (existing?.attemptCount ?? 0) + 1, updatedAt: new Date() })
        .where(eq(notificationDeliveries.dedupKey, dedupKey));

      return "CLAIMED";
    }
  }

  /** Recipient address plus everything the template needs. */
  private async loadContext(bookingId: string, type: NotificationType) {
    const [row] = await this.database.db
      .select({
        booking: bookings,
        hostEmail: users.email,
        checkInTime: propertyStayInformation.checkInTime,
        checkOutTime: propertyStayInformation.checkOutTime,
      })
      .from(bookings)
      .innerJoin(hosts, eq(hosts.id, bookings.hostId))
      .leftJoin(users, eq(users.id, hosts.userId))
      .leftJoin(
        propertyStayInformation,
        eq(propertyStayInformation.propertyId, bookings.propertyId),
      )
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) return null;

    const goesToHost = NOTIFICATION_RECIPIENTS[type] === "HOST";
    // Host address always comes from the account, never duplicated on Property.
    const recipient = goesToHost ? row.hostEmail : row.booking.guestEmail;
    if (!recipient) return null;

    const booking = row.booking;

    // A Guest link is only minted for messages the Guest actually receives.
    const guestUrl = goesToHost
      ? undefined
      : await this.guestAccess.buildAccessUrl(booking.id, booking.publicReference, this.appBaseUrl);

    return {
      recipient,
      email: {
        reference: booking.publicReference,
        propertyTitle: booking.propertyTitleSnapshot,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        adults: booking.adults,
        children: booking.children,
        totalAmountMinor: booking.totalAmountMinor,
        currency: booking.currency,
        guestName: booking.guestName,
        guestUrl,
        hostUrl: goesToHost ? `${this.appBaseUrl}/host/bookings/${booking.id}` : undefined,
        hostResponseDeadlineAt: booking.hostResponseDeadlineAt?.toISOString() ?? null,
        checkInTime: row.checkInTime,
        checkOutTime: row.checkOutTime,
        messageAuthor: booking.guestName,
      },
    };
  }
}
