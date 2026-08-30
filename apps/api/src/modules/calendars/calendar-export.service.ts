import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { calendarExportTokens, properties } from "../../infrastructure/database/schema";
import type { DateRange } from "../../domain/availability";

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class CalendarExportService {
  private readonly logger = new Logger(CalendarExportService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Issues a fresh token and revokes whatever came before, so "regenerate" and
   * "create" are the same operation and an old URL always stops working
   * (milestone 03 §43). The raw token is returned exactly once.
   */
  async issue(propertyId: string): Promise<{ token: string; createdAt: Date }> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");

    const createdAt = await this.database.db.transaction(async (tx) => {
      await tx
        .update(calendarExportTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(calendarExportTokens.propertyId, propertyId),
            isNull(calendarExportTokens.revokedAt),
          ),
        );

      const [row] = await tx
        .insert(calendarExportTokens)
        .values({ propertyId, tokenHash: hashToken(token) })
        .returning({ createdAt: calendarExportTokens.createdAt });

      return row.createdAt;
    });

    // The raw token never reaches the log — it is a credential (§40).
    this.logger.log({ event: "calendar.export.issued", propertyId });

    return { token, createdAt };
  }

  async revoke(propertyId: string): Promise<void> {
    await this.database.db
      .update(calendarExportTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(calendarExportTokens.propertyId, propertyId),
          isNull(calendarExportTokens.revokedAt),
        ),
      );

    this.logger.log({ event: "calendar.export.revoked", propertyId });
  }

  async status(propertyId: string): Promise<{ active: boolean; createdAt: Date | null }> {
    const [row] = await this.database.db
      .select({ createdAt: calendarExportTokens.createdAt })
      .from(calendarExportTokens)
      .where(
        and(
          eq(calendarExportTokens.propertyId, propertyId),
          isNull(calendarExportTokens.revokedAt),
        ),
      )
      .limit(1);

    return { active: Boolean(row), createdAt: row?.createdAt ?? null };
  }

  /**
   * Builds the .ics for a token. Only HOST_BLOCK is exported: re-publishing
   * blocks that came from another platform would feed them back to that
   * platform on the next sync, and two calendars would block each other
   * forever (milestone 03 §34).
   */
  async render(token: string): Promise<string> {
    const [row] = await this.database.db
      .select({
        propertyId: calendarExportTokens.propertyId,
        title: properties.title,
      })
      .from(calendarExportTokens)
      .innerJoin(properties, eq(properties.id, calendarExportTokens.propertyId))
      .where(
        and(
          eq(calendarExportTokens.tokenHash, hashToken(token)),
          isNull(calendarExportTokens.revokedAt),
        ),
      )
      .limit(1);

    // A revoked or unknown token is indistinguishable from one that never
    // existed.
    if (!row) throw new NotFoundException("Nieznany albo unieważniony token eksportu.");

    const blocks = (await this.database.db.execute(sql`
      SELECT id,
             lower(date_range)::text AS start_date,
             upper(date_range)::text AS end_date
      FROM availability_blocks
      WHERE property_id = ${row.propertyId}
        AND source_type = 'HOST_BLOCK'
      ORDER BY lower(date_range) ASC
    `)) as unknown as { id: string; start_date: string; end_date: string }[];

    return this.toIcal(
      blocks.map((block) => ({
        id: block.id,
        startDate: block.start_date,
        endDate: block.end_date,
      })),
    );
  }

  private toIcal(blocks: (DateRange & { id: string })[]): string {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Rezervio//Availability//PL",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    for (const block of blocks) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:availability-block-${block.id}@rezervio`,
        `DTSTART;VALUE=DATE:${compact(block.startDate)}`,
        // Already exclusive, matching how the range is stored — no ±1 anywhere.
        `DTEND;VALUE=DATE:${compact(block.endDate)}`,
        // Nothing else: no Host note, no provider, no guest data (§42).
        "SUMMARY:Unavailable",
        "END:VEVENT",
      );
    }

    lines.push("END:VCALENDAR");
    // RFC 5545 wants CRLF.
    return `${lines.join("\r\n")}\r\n`;
  }
}

function compact(date: string): string {
  return date.replace(/-/g, "");
}
