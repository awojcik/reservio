import type { EmailMessage } from "../domain/notification";

/**
 * The only thing the rest of the application knows about email.
 *
 * Swapping Mailpit for Resend, Postmark or SES is an infrastructure change;
 * BookingService never learns which one is in use (milestone 05 §6, §9).
 */
export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
