import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { CurrentHost, HostGuard } from "../auth/auth.guards";
import type { HostRow } from "../../infrastructure/database/schema";
import { HostPropertiesService } from "../properties/host/host-properties.service";
import { CalendarExportService } from "./calendar-export.service";
import { CalendarSyncWorker } from "./calendar-sync.worker";
import { ExternalCalendarsService } from "./external-calendars.service";
import {
  CalendarExportStatusDto,
  CalendarExportTokenDto,
  CreateExternalCalendarDto,
  ExternalCalendarDto,
  UpdateExternalCalendarDto,
} from "./dto/external-calendar.dto";

@ApiTags("host")
@ApiCookieAuth("rezervio_session")
@ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
@ApiForbiddenResponse({ description: "Konto bez profilu Host" })
@ApiNotFoundResponse({ description: "Property nie istnieje lub należy do innego Host" })
@UseGuards(HostGuard)
@Controller("host/properties")
export class HostCalendarsController {
  constructor(
    private readonly calendars: ExternalCalendarsService,
    private readonly exports: CalendarExportService,
    private readonly worker: CalendarSyncWorker,
    private readonly hostProperties: HostPropertiesService,
    private readonly config: ConfigService,
  ) {}

  @Get(":id/external-calendars")
  @ApiOperation({
    summary: "Kalendarze zewnętrzne Property",
    description: "Adres feedu zwracany jest wyłącznie w formie zamaskowanej.",
  })
  @ApiOkResponse({ type: [ExternalCalendarDto] })
  async list(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ExternalCalendarDto[]> {
    await this.hostProperties.findOwned(host.id, id);
    return this.calendars.list(id);
  }

  @Post(":id/external-calendars")
  @ApiOperation({
    summary: "Podpięcie feedu iCal",
    description:
      "Adres jest walidowany, szyfrowany i zapisywany, a pierwsza synchronizacja trafia do kolejki.",
  })
  @ApiCreatedResponse({ type: ExternalCalendarDto })
  async create(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateExternalCalendarDto,
  ): Promise<ExternalCalendarDto> {
    await this.hostProperties.findOwned(host.id, id);

    const calendar = await this.calendars.create(id, dto);
    await this.worker.enqueue(calendar.id, true);

    return this.calendars.toDto(calendar);
  }

  @Patch(":id/external-calendars/:calendarId")
  @ApiOperation({
    summary: "Edycja kalendarza",
    description:
      "Wyłączenie kalendarza usuwa zaimportowane przez niego terminy; blokad ręcznych nie rusza.",
  })
  @ApiOkResponse({ type: ExternalCalendarDto })
  async update(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("calendarId", ParseUUIDPipe) calendarId: string,
    @Body() dto: UpdateExternalCalendarDto,
  ): Promise<ExternalCalendarDto> {
    await this.hostProperties.findOwned(host.id, id);

    const calendar = await this.calendars.update(id, calendarId, dto);
    if (dto.importUrl !== undefined && calendar.status === "ACTIVE") {
      await this.worker.enqueue(calendar.id, true);
    }
    return this.calendars.toDto(calendar);
  }

  @Delete(":id/external-calendars/:calendarId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Odpięcie kalendarza",
    description: "Usuwa kalendarz razem z zaimportowanymi terminami.",
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("calendarId", ParseUUIDPipe) calendarId: string,
  ): Promise<void> {
    await this.hostProperties.findOwned(host.id, id);
    await this.calendars.remove(id, calendarId);
  }

  @Post(":id/external-calendars/:calendarId/sync")
  @HttpCode(202)
  @ApiOperation({
    summary: "Synchronizuj teraz",
    description:
      "Zadanie trafia do kolejki. Feed nie jest pobierany w wątku żądania, a ponowne kliknięcia są deduplikowane.",
  })
  @ApiAcceptedResponse({ description: "Synchronizacja zakolejkowana" })
  async syncNow(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("calendarId", ParseUUIDPipe) calendarId: string,
  ): Promise<{ status: string }> {
    await this.hostProperties.findOwned(host.id, id);
    const calendar = await this.calendars.findOwned(id, calendarId);

    await this.worker.enqueue(calendar.id, true);
    return { status: "QUEUED" };
  }

  @Get(":id/calendar-export")
  @ApiOperation({ summary: "Stan adresu eksportu" })
  @ApiOkResponse({ type: CalendarExportStatusDto })
  async exportStatus(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CalendarExportStatusDto> {
    await this.hostProperties.findOwned(host.id, id);

    const status = await this.exports.status(id);
    return { active: status.active, createdAt: status.createdAt?.toISOString() ?? null };
  }

  @Post(":id/calendar-export")
  @HttpCode(200)
  @ApiOperation({
    summary: "Wygenerowanie adresu eksportu",
    description: "Pełny adres zwracany jest tylko teraz — później dostępny jest wyłącznie stan.",
  })
  @ApiOkResponse({ type: CalendarExportTokenDto })
  create_export(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CalendarExportTokenDto> {
    return this.issueToken(host, id);
  }

  @Post(":id/calendar-export/regenerate")
  @HttpCode(200)
  @ApiOperation({
    summary: "Rotacja adresu eksportu",
    description: "Poprzedni adres natychmiast przestaje działać.",
  })
  @ApiOkResponse({ type: CalendarExportTokenDto })
  regenerate(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CalendarExportTokenDto> {
    return this.issueToken(host, id);
  }

  @Delete(":id/calendar-export")
  @HttpCode(204)
  @ApiOperation({ summary: "Unieważnienie adresu eksportu" })
  @ApiNoContentResponse()
  async revoke(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.hostProperties.findOwned(host.id, id);
    await this.exports.revoke(id);
  }

  private async issueToken(host: HostRow, id: string): Promise<CalendarExportTokenDto> {
    await this.hostProperties.findOwned(host.id, id);

    const { token, createdAt } = await this.exports.issue(id);
    const base = (this.config.get<string>("PUBLIC_API_URL") ?? "http://localhost:3001/api")
      .replace(/\/$/, "");

    return { url: `${base}/calendar/ical/${token}.ics`, createdAt: createdAt.toISOString() };
  }
}
