import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Application error codes.
 *
 * A code is a promise to the client that a condition is stable and can be
 * branched on; an HTTP status alone cannot distinguish "this Host has not
 * finished onboarding" from "this Settlement is not due yet", and a Polish
 * sentence is not something a frontend should match against.
 *
 * Deliberately not a migration of every old error: the operational and admin
 * flows added in this milestone use codes, and the rest keeps working
 * unchanged (milestone 11 §15).
 */
export enum AppErrorCode {
  ADMIN_FORBIDDEN = "ADMIN_FORBIDDEN",
  RATE_LIMITED = "RATE_LIMITED",
  INVALID_ORIGIN = "INVALID_ORIGIN",

  PAYMENT_PROVIDER_ERROR = "PAYMENT_PROVIDER_ERROR",
  PAYMENT_INTEGRITY_ERROR = "PAYMENT_INTEGRITY_ERROR",
  REFUND_FAILED = "REFUND_FAILED",

  SETTLEMENT_NOT_READY = "SETTLEMENT_NOT_READY",
  HOST_PAYMENT_ACCOUNT_NOT_READY = "HOST_PAYMENT_ACCOUNT_NOT_READY",
  TRANSFER_FAILED = "TRANSFER_FAILED",

  ICAL_SYNC_FAILED = "ICAL_SYNC_FAILED",
  GEOCODING_UNAVAILABLE = "GEOCODING_UNAVAILABLE",

  /** External connectivity — a PMS or a channel manager (milestone 12 §15). */
  PROVIDER_ERROR = "PROVIDER_ERROR",
  INTEGRATION_NOT_CONNECTED = "INTEGRATION_NOT_CONNECTED",
  PARTNER_ACCESS_REQUIRED = "PARTNER_ACCESS_REQUIRED",
  PROPERTY_ALREADY_MAPPED = "PROPERTY_ALREADY_MAPPED",
  OUTBOUND_SYNC_FAILED = "OUTBOUND_SYNC_FAILED",
  EXTERNAL_RESERVATION_CONFLICT = "EXTERNAL_RESERVATION_CONFLICT",
  NOTIFICATION_FAILED = "NOTIFICATION_FAILED",
  JOB_NOT_RETRYABLE = "JOB_NOT_RETRYABLE",
}

/**
 * An error that carries its code in the body.
 *
 * The message is for a person, the code is for a program; keeping both in one
 * shape means a handler never has to decide which to send.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.CONFLICT,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, ...(details ? { details } : {}) }, status);
  }
}
