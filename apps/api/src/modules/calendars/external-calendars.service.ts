import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  availabilityBlocks,
  externalCalendars,
  type ExternalCalendarRow,
} from "../../infrastructure/database/schema";
import { assertAllowedUrl } from "./safe-fetch";
import { IcalUrlCipher } from "./ical-url-cipher";
import type {
  CreateExternalCalendarDto,
  ExternalCalendarDto,
  UpdateExternalCalendarDto,
} from "./dto/external-calendar.dto";

@Injectable()
export class ExternalCalendarsService {
  private readonly logger = new Logger(ExternalCalendarsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly cipher: IcalUrlCipher,
    private readonly config: ConfigService,
  ) {}

  /**
   * Must match what the fetcher will do later, otherwise a URL accepted by the
   * form would be refused by every sync — or worse, the other way round.
   */
  private get allowPrivateHosts(): boolean {
    return this.config.get("ICAL_ALLOW_PRIVATE_HOSTS") === "true";
  }

  async list(propertyId: string): Promise<ExternalCalendarDto[]> {
    const rows = await this.database.db
      .select()
      .from(externalCalendars)
      .where(eq(externalCalendars.propertyId, propertyId))
      .orderBy(externalCalendars.createdAt);

    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async findOwned(propertyId: string, calendarId: string): Promise<ExternalCalendarRow> {
    const [row] = await this.database.db
      .select()
      .from(externalCalendars)
      .where(
        and(
          eq(externalCalendars.id, calendarId),
          eq(externalCalendars.propertyId, propertyId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException("Nie znaleziono kalendarza.");
    return row;
  }

  /**
   * The URL is checked for scheme and obvious private targets before it is
   * ever stored, so an unusable feed is rejected while the Host is still
   * looking at the form rather than silently failing later in a background job.
   * The full SSRF check, including DNS, runs again at fetch time.
   */
  async create(
    propertyId: string,
    dto: CreateExternalCalendarDto,
  ): Promise<ExternalCalendarRow> {
    assertAllowedUrl(dto.importUrl, this.allowPrivateHosts);

    const [row] = await this.database.db
      .insert(externalCalendars)
      .values({
        propertyId,
        provider: dto.provider,
        name: dto.name,
        importUrlEncrypted: this.cipher.encrypt(dto.importUrl),
        status: "ACTIVE",
      })
      .returning();

    // The URL itself is deliberately absent from this line (§51).
    this.logger.log({
      event: "calendar.created",
      calendarId: row.id,
      propertyId,
      provider: row.provider,
    });

    return row;
  }

  async update(
    propertyId: string,
    calendarId: string,
    dto: UpdateExternalCalendarDto,
  ): Promise<ExternalCalendarRow> {
    const current = await this.findOwned(propertyId, calendarId);

    const patch: Partial<typeof externalCalendars.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;

    if (dto.importUrl !== undefined) {
      assertAllowedUrl(dto.importUrl, this.allowPrivateHosts);
      patch.importUrlEncrypted = this.cipher.encrypt(dto.importUrl);
      // A new feed makes the old failure history meaningless.
      patch.consecutiveFailures = 0;
      patch.lastErrorCode = null;
      patch.lastErrorMessage = null;
    }

    if (dto.status !== undefined) {
      patch.status = dto.status;
    }

    const [row] = await this.database.db
      .update(externalCalendars)
      .set(patch)
      .where(eq(externalCalendars.id, current.id))
      .returning();

    // Disabling a calendar has to release the dates it was holding, or the
    // Property stays blocked by a feed nobody is reading any more (§22).
    if (dto.status === "DISABLED" && current.status !== "DISABLED") {
      await this.dropImportedBlocks(current.id);
    }

    return row;
  }

  /**
   * Removing a calendar removes exactly the blocks it imported. Manual blocks
   * are untouched — the Host put those there deliberately (§22).
   */
  async remove(propertyId: string, calendarId: string): Promise<void> {
    const calendar = await this.findOwned(propertyId, calendarId);

    // One transaction, and the FK cascade would drop the blocks anyway; doing
    // it explicitly keeps the intent visible and the log honest.
    await this.database.db.transaction(async (tx) => {
      await tx
        .delete(availabilityBlocks)
        .where(eq(availabilityBlocks.externalCalendarId, calendar.id));
      await tx.delete(externalCalendars).where(eq(externalCalendars.id, calendar.id));
    });

    this.logger.log({
      event: "calendar.removed",
      calendarId: calendar.id,
      propertyId,
      provider: calendar.provider,
    });
  }

  async toDto(row: ExternalCalendarRow): Promise<ExternalCalendarDto> {
    const [{ count }] = (await this.database.db.execute(sql`
      SELECT count(*)::int AS count FROM availability_blocks
      WHERE external_calendar_id = ${row.id}
    `)) as unknown as { count: number }[];

    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      maskedUrl: this.maskedUrl(row.importUrlEncrypted),
      status: row.status,
      lastSyncSucceededAt: row.lastSyncSucceededAt?.toISOString() ?? null,
      lastSyncFailedAt: row.lastSyncFailedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      consecutiveFailures: row.consecutiveFailures,
      importedBlockCount: count,
    };
  }

  private maskedUrl(encrypted: string): string {
    try {
      return IcalUrlCipher.mask(this.cipher.decrypt(encrypted));
    } catch {
      // A payload encrypted under a rotated key should not break the list view.
      return "…";
    }
  }

  private async dropImportedBlocks(calendarId: string): Promise<void> {
    await this.database.db
      .delete(availabilityBlocks)
      .where(eq(availabilityBlocks.externalCalendarId, calendarId));
  }
}
