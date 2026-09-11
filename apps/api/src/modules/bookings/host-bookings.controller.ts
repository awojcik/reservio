import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { CurrentHost, HostGuard } from "../auth/auth.guards";
import type { HostRow } from "../../infrastructure/database/schema";
import { BookingHoldWorker } from "./booking-hold.worker";
import { BookingsService } from "./bookings.service";
import { toHostBookingDto } from "./booking-mapper";
import {
  HostBookingDto,
  HostBookingsPageDto,
  HostBookingsQueryDto,
} from "./dto/booking.dto";

@ApiTags("host")
@ApiCookieAuth("rezervio_session")
@ApiUnauthorizedResponse({ description: "Brak aktywnej sesji" })
@ApiForbiddenResponse({ description: "Konto bez profilu Host" })
@ApiNotFoundResponse({ description: "Rezerwacja nie istnieje lub należy do innego Host" })
@UseGuards(HostGuard)
@Controller("host/bookings")
export class HostBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly holds: BookingHoldWorker,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Rezerwacje obiektów gospodarza",
    description:
      "Filtrowanie po statusie, obiekcie i zakresie dat, wyszukiwanie po numerze, imieniu i emailu gościa, sortowanie i paginacja.",
  })
  @ApiOkResponse({ type: HostBookingsPageDto })
  async list(
    @CurrentHost() host: HostRow,
    @Query() query: HostBookingsQueryDto,
  ): Promise<HostBookingsPageDto> {
    const { items, total } = await this.bookings.listForHost(host.id, query);

    // One batched lookup instead of a hold query per row.
    const holds = await this.bookings.activeHoldsFor(items.map((item) => item.id));

    return {
      items: items.map((booking) =>
        toHostBookingDto(booking, holds.get(booking.id) ?? null),
      ),
      total,
      hasMore: (query.offset ?? 0) + items.length < total,
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Szczegóły rezerwacji" })
  @ApiOkResponse({ type: HostBookingDto })
  async detail(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostBookingDto> {
    const { booking, holdExpiresAt } = await this.bookings.findForHost(host.id, id);
    const events = await this.bookings.timelineFor(booking.id);
    return toHostBookingDto(booking, holdExpiresAt, events);
  }

  @Post(":id/accept")
  @HttpCode(200)
  @ApiOperation({
    summary: "Akceptacja prośby o rezerwację",
    description:
      "Ponownie sprawdza dostępność w transakcji. Jeśli termin zdążył się zająć, zwraca 409, a rezerwacja dostaje status EXPIRED z powodem AVAILABILITY_LOST.",
  })
  @ApiOkResponse({ type: HostBookingDto })
  @ApiConflictResponse({ description: "PROPERTY_NOT_AVAILABLE albo prośba już rozpatrzona" })
  async accept(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostBookingDto> {
    const { booking, holdExpiresAt } = await this.bookings.acceptBookingRequest(host.id, id);

    if (holdExpiresAt) {
      const hold = await this.bookings.findActiveHold(booking.id);
      if (hold) await this.holds.scheduleExpiry(hold.id, hold.expiresAt);
    }

    const events = await this.bookings.timelineFor(booking.id);
    return toHostBookingDto(booking, holdExpiresAt, events);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Anulowanie rezerwacji przez gospodarza",
    description:
      "Dozwolone, dopóki rezerwacja czeka na decyzję albo na płatność. Zwalnia blokadę terminu i zawiadamia gościa.",
  })
  @ApiOkResponse({ type: HostBookingDto })
  @ApiConflictResponse({ description: "BOOKING_NOT_CANCELLABLE" })
  async cancel(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostBookingDto> {
    const booking = await this.bookings.cancelBookingByHost(host.id, id);
    const events = await this.bookings.timelineFor(booking.id);
    return toHostBookingDto(booking, null, events);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @ApiOperation({
    summary: "Odrzucenie prośby o rezerwację",
    description: "Bezpieczne przy ponowieniu — odrzucenie już odrzuconej prośby nic nie zmienia.",
  })
  @ApiOkResponse({ type: HostBookingDto })
  async reject(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HostBookingDto> {
    const booking = await this.bookings.rejectBookingRequest(host.id, id);
    const events = await this.bookings.timelineFor(booking.id);
    return toHostBookingDto(booking, null, events);
  }
}
