import { Controller, Get, Header, Param } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CalendarExportService } from "./calendar-export.service";

@ApiTags("calendar")
@Controller("calendar")
export class PublicCalendarController {
  constructor(private readonly exports: CalendarExportService) {}

  /**
   * Deliberately unauthenticated: the token in the path is the credential, so
   * an external system can subscribe without holding a Rezervio session.
   */
  @Get("ical/:token.ics")
  @Header("content-type", "text/calendar; charset=utf-8")
  @Header("cache-control", "no-store")
  @ApiOperation({
    summary: "Eksport iCal",
    description:
      "Zwraca wyłącznie blokady ręczne Host. Terminy zaimportowane z innych kalendarzy nigdy nie są eksportowane.",
  })
  @ApiOkResponse({ description: "Dokument iCalendar" })
  @ApiNotFoundResponse({ description: "Token nieznany albo unieważniony" })
  render(@Param("token") token: string): Promise<string> {
    return this.exports.render(token);
  }
}
