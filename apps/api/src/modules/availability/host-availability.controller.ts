import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { inArray } from "drizzle-orm";

import { CurrentHost, HostGuard } from "../auth/auth.guards";
import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import { externalCalendars, type HostRow } from "../../infrastructure/database/schema";
import { Inject } from "@nestjs/common";
import { HostPropertiesService } from "../properties/host/host-properties.service";
import { AvailabilityService } from "./availability.service";
import {
  BlockDatesDto,
  CalendarWindowDto,
  HostCalendarBlockDto,
  HostCalendarDto,
  UnblockDatesDto,
} from "./dto/availability.dto";

const SOURCE_LABELS: Record<string, string> = {
  HOST_BLOCK: "Ręczna blokada",
  EXTERNAL_CALENDAR: "Kalendarz zewnętrzny",
  BOOKING: "Rezerwacja",
  BOOKING_HOLD: "Tymczasowa blokada",
  MAINTENANCE: "Prace serwisowe",
};

/**
 * Calendar management for the signed-in Host. Ownership is resolved through
 * HostPropertiesService, so a foreign Property answers 404 exactly as it does
 * everywhere else in the Host area (milestone 03 §49).
 */
@ApiTags("host")
@ApiCookieAuth("rezervio_session")
@ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
@ApiForbiddenResponse({ description: "Konto bez profilu Host" })
@ApiNotFoundResponse({ description: "Property nie istnieje lub należy do innego Host" })
@UseGuards(HostGuard)
@Controller("host/properties")
export class HostAvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly hostProperties: HostPropertiesService,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  @Get(":id/calendar")
  @ApiOperation({
    summary: "Kalendarz Property",
    description:
      "Zwraca zakresy, nie wiersz na każdy dzień. endDate jest exclusive.",
  })
  @ApiOkResponse({ type: HostCalendarDto })
  async calendar(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() window: CalendarWindowDto,
  ): Promise<HostCalendarDto> {
    await this.hostProperties.findOwned(host.id, id);

    const blocks = await this.availability.getBlocks(id, {
      startDate: window.from,
      endDate: window.to,
    });

    const calendarNames = await this.calendarNames(
      blocks
        .map((block) => block.externalCalendarId)
        .filter((value): value is string => value !== null),
    );

    return {
      propertyId: id,
      from: window.from,
      to: window.to,
      blocks: blocks.map(
        (block): HostCalendarBlockDto => ({
          id: block.id,
          startDate: block.startDate,
          endDate: block.endDate,
          sourceType: block.sourceType,
          sourceLabel: SOURCE_LABELS[block.sourceType] ?? block.sourceType,
          calendarName: block.externalCalendarId
            ? (calendarNames.get(block.externalCalendarId) ?? null)
            : null,
          note: block.note,
        }),
      ),
    };
  }

  @Post(":id/availability/block")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ręczna blokada terminu",
    description:
      "Tworzy HOST_BLOCK i scala go z przylegającymi oraz nachodzącymi blokadami ręcznymi. Blokad z kalendarzy zewnętrznych nie dotyka.",
  })
  @ApiOkResponse({ type: HostCalendarDto })
  async block(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: BlockDatesDto,
  ): Promise<HostCalendarDto> {
    await this.hostProperties.findOwned(host.id, id);
    await this.availability.blockDates(
      id,
      { startDate: dto.startDate, endDate: dto.endDate },
      dto.note ?? null,
    );
    return this.calendar(host, id, { from: dto.startDate, to: dto.endDate });
  }

  @Post(":id/availability/unblock")
  @HttpCode(200)
  @ApiOperation({
    summary: "Zdjęcie ręcznej blokady",
    description:
      "Usuwa, przycina albo dzieli HOST_BLOCK. Nigdy nie usuwa blokad z kalendarzy zewnętrznych.",
  })
  @ApiOkResponse({ type: HostCalendarDto })
  async unblock(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UnblockDatesDto,
  ): Promise<HostCalendarDto> {
    await this.hostProperties.findOwned(host.id, id);
    await this.availability.unblockDates(id, {
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    return this.calendar(host, id, { from: dto.startDate, to: dto.endDate });
  }

  private async calendarNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database.db
      .select({ id: externalCalendars.id, name: externalCalendars.name })
      .from(externalCalendars)
      .where(inArray(externalCalendars.id, [...new Set(ids)]));

    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
