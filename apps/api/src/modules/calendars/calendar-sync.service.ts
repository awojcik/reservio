import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { externalCalendars, properties } from "../../infrastructure/database/schema";
import { addDays, today, type DateRange } from "../../domain/availability";
import { AvailabilityService } from "../availability/availability.service";
import { IcalUrlCipher } from "./ical-url-cipher";
import { IcalParseError, parseIcal } from "./ical-parser";
import { FetchFailedError, UnsafeUrlError, safeFetchIcal } from "./safe-fetch";

/** Errors worth another attempt, versus ones that will fail identically forever. */
export const PERMANENT_ERROR_CODES = new Set([
  "SECURITY_REJECTED",
  "PARSE_ERROR",
  "DECRYPT_ERROR",
  "CALENDAR_MISSING",
]);

export class CalendarSyncError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export type SyncOutcome = {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
};

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly availability: AvailabilityService,
    private readonly cipher: IcalUrlCipher,
    private readonly config: ConfigService,
  ) {}

  /**
   * One calendar, start to finish.
   *
   * Network work — fetch, parse, normalise — happens entirely outside any
   * database transaction (milestone 03 §50). Only once a complete, valid
   * snapshot exists does a single transaction reconcile it. That ordering is
   * what makes §33 hold: a feed that times out leaves yesterday's blocks in
   * place instead of quietly freeing the Property's calendar.
   */
  async sync(externalCalendarId: string): Promise<SyncOutcome> {
    const startedAt = Date.now();

    const [calendar] = await this.database.db
      .select()
      .from(externalCalendars)
      .where(eq(externalCalendars.id, externalCalendarId))
      .limit(1);

    if (!calendar) {
      throw new CalendarSyncError("Kalendarz nie istnieje.", "CALENDAR_MISSING", true);
    }

    const [property] = await this.database.db
      .select({ id: properties.id, timeZone: properties.timeZone })
      .from(properties)
      .where(eq(properties.id, calendar.propertyId))
      .limit(1);

    if (!property) {
      throw new CalendarSyncError("Property nie istnieje.", "CALENDAR_MISSING", true);
    }

    await this.database.db
      .update(externalCalendars)
      .set({ lastSyncStartedAt: new Date() })
      .where(eq(externalCalendars.id, calendar.id));

    this.logger.log({
      event: "calendar.sync.started",
      calendarId: calendar.id,
      propertyId: property.id,
      provider: calendar.provider,
    });

    try {
      const url = this.decryptUrl(calendar.importUrlEncrypted);
      const horizon = this.horizonFor(property.timeZone);

      const { body } = await safeFetchIcal(url, {
        timeoutMs: Number(this.config.get("ICAL_FETCH_TIMEOUT_MS") ?? 10_000),
        maxBytes: Number(this.config.get("ICAL_MAX_RESPONSE_BYTES") ?? 5_242_880),
        maxRedirects: 3,
        // Development convenience only; forced off in production by
        // privateHostsAllowed().
        allowPrivateHosts: this.config.get("ICAL_ALLOW_PRIVATE_HOSTS") === "true",
      });

      const parsed = parseIcal(body, property.timeZone);

      // Only events touching the horizon are our business; the reconcile step
      // is told the same window so it never deletes blocks it cannot see.
      const withinHorizon = parsed.events.filter(
        (event) =>
          event.range.startDate < horizon.endDate && horizon.startDate < event.range.endDate,
      );

      const result = await this.availability.reconcileExternalBlocks(
        property.id,
        calendar.id,
        withinHorizon,
        horizon,
      );

      await this.database.db
        .update(externalCalendars)
        .set({
          lastSyncSucceededAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          consecutiveFailures: 0,
          updatedAt: new Date(),
        })
        .where(eq(externalCalendars.id, calendar.id));

      this.logger.log({
        event: "calendar.sync.succeeded",
        calendarId: calendar.id,
        propertyId: property.id,
        provider: calendar.provider,
        durationMs: Date.now() - startedAt,
        eventCount: withinHorizon.length,
        ...result,
      });
      this.logger.log({
        event: "calendar.sync.events_imported",
        calendarId: calendar.id,
        eventCount: withinHorizon.length,
        skipped: parsed.skipped.length,
      });

      return { ...result, skipped: parsed.skipped.length };
    } catch (error) {
      const failure = this.classify(error);

      await this.recordFailure(calendar.id, failure);

      this.logger.warn({
        event:
          failure.code === "SECURITY_REJECTED"
            ? "calendar.sync.security_rejected"
            : "calendar.sync.failed",
        calendarId: calendar.id,
        propertyId: property.id,
        provider: calendar.provider,
        durationMs: Date.now() - startedAt,
        errorCode: failure.code,
      });

      throw failure;
    }
  }

  /** today−30 … today+540, in the Property's own timezone (milestone 03 §30). */
  horizonFor(timeZone: string): DateRange {
    const now = today(timeZone);
    return { startDate: addDays(now, -30), endDate: addDays(now, 540) };
  }

  private decryptUrl(encrypted: string): string {
    try {
      return this.cipher.decrypt(encrypted);
    } catch {
      throw new CalendarSyncError(
        "Nie udało się odszyfrować adresu kalendarza.",
        "DECRYPT_ERROR",
        true,
      );
    }
  }

  private classify(error: unknown): CalendarSyncError {
    if (error instanceof CalendarSyncError) return error;

    if (error instanceof UnsafeUrlError) {
      return new CalendarSyncError(error.message, "SECURITY_REJECTED", true);
    }
    if (error instanceof IcalParseError) {
      return new CalendarSyncError(error.message, "PARSE_ERROR", true);
    }
    if (error instanceof FetchFailedError) {
      return new CalendarSyncError(
        error.message,
        error.code,
        PERMANENT_ERROR_CODES.has(error.code),
      );
    }

    return new CalendarSyncError((error as Error).message, "UNKNOWN", false);
  }

  /**
   * Records why a sync failed and nothing else. No availability_blocks are
   * touched here — that omission is the whole of §33, so it is deliberate
   * rather than accidental.
   *
   * The counter is incremented in SQL so two concurrent attempts cannot read
   * the same value and both write back the same increment.
   */
  private async recordFailure(calendarId: string, failure: CalendarSyncError): Promise<void> {
    await this.database.db.execute(sql`
      UPDATE external_calendars
      SET last_sync_failed_at = now(),
          last_error_code = ${failure.code},
          last_error_message = ${failure.message.slice(0, 500)},
          consecutive_failures = consecutive_failures + 1,
          updated_at = now()
      WHERE id = ${calendarId}
    `);
  }
}
