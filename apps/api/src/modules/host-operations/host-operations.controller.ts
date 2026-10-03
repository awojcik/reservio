import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { CurrentHost, HostGuard } from "../auth/auth.guards";
import type { HostRow } from "../../infrastructure/database/schema";
import { HostCalendarService } from "./host-calendar.service";
import { HostOperationsService } from "./host-operations.service";
import { HostDashboardDto } from "./dto/dashboard.dto";
import { HostAllCalendarDto, HostAllCalendarQueryDto } from "./dto/host-calendar.dto";

/**
 * Read-only operational views. Both are scoped to the authenticated Host —
 * neither takes a hostId, so one Host cannot ask for another's data.
 */
@ApiTags("host")
@ApiCookieAuth("rezervio_session")
@ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
@ApiForbiddenResponse({ description: "Konto bez profilu Host" })
@UseGuards(HostGuard)
@Controller("host")
export class HostOperationsController {
  constructor(
    private readonly operations: HostOperationsService,
    private readonly calendar: HostCalendarService,
  ) {}

  @Get("dashboard")
  @ApiOperation({
    summary: "Pulpit operacyjny gospodarza",
    description:
      "Jedno żądanie zwraca wszystko, co pulpit pokazuje. To projekcja odczytowa liczona z istniejących tabel — nie ma osobnego źródła prawdy dla pulpitu.",
  })
  @ApiOkResponse({ type: HostDashboardDto })
  dashboard(@CurrentHost() host: HostRow): Promise<HostDashboardDto> {
    return this.operations.dashboard(host.id);
  }

  @Get("calendar")
  @ApiOperation({
    summary: "Kalendarz wszystkich obiektów",
    description:
      "Rezerwacje, aktywne blokady tymczasowe, blokady ręczne i terminy z kalendarzy zewnętrznych — pogrupowane po obiekcie. Wygasłe blokady nie są zwracane.",
  })
  @ApiOkResponse({ type: HostAllCalendarDto })
  calendarFor(
    @CurrentHost() host: HostRow,
    @Query() query: HostAllCalendarQueryDto,
  ): Promise<HostAllCalendarDto> {
    return this.calendar.calendar(host.id, query);
  }
}
