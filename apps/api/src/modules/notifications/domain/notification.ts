import type { NotificationType } from "../../../infrastructure/database/schema";

/**
 * Who a notification is for, and the logical key that makes it send once.
 *
 * The dedup key is derived from the event, not from the job: a retried job, a
 * replayed outbox row and a duplicate enqueue all produce the same key, and
 * the unique index on it is what turns "at least once" delivery into "exactly
 * one email" (milestone 05 §12).
 */
export type NotificationRecipient = "GUEST" | "HOST";

export const NOTIFICATION_RECIPIENTS: Record<NotificationType, NotificationRecipient> = {
  BOOKING_REQUEST_CREATED: "HOST",
  BOOKING_REQUEST_REMINDER: "HOST",
  BOOKING_CANCELLED_BY_GUEST: "HOST",

  BOOKING_REQUEST_ACCEPTED: "GUEST",
  BOOKING_REQUEST_REJECTED: "GUEST",
  BOOKING_REQUEST_EXPIRED: "GUEST",
  BOOKING_CANCELLED_BY_HOST: "GUEST",
  BOOKING_CONFIRMED: "GUEST",
};

export function dedupKeyFor(type: NotificationType, bookingId: string): string {
  return `${type.toLowerCase().replace(/_/g, "-")}:${bookingId}`;
}

/** A rendered message, ready for whichever provider is configured. */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Errors the provider considers final. Retrying a rejected recipient just
 * burns attempts and, with some providers, reputation (milestone 05 §14).
 */
export class PermanentEmailError extends Error {
  readonly permanent = true;

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class TemporaryEmailError extends Error {
  readonly permanent = false;

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
