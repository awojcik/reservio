import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { ConflictException } from "@nestjs/common";

import { CurrentHost, HostGuard } from "../auth/auth.guards";
import type { HostRow } from "../../infrastructure/database/schema";
import { BookingsService } from "../bookings/bookings.service";
import { StayLifecycleWorker } from "./stay-lifecycle.worker";
import { NotificationWorker } from "../notifications/application/notification.worker";
import {
  BookingAccessStatusDto,
  SensitiveAccessDto,
  StayInformationDto,
  UpdateSensitiveAccessDto,
  UpdateStayInformationDto,
} from "./dto/stay.dto";
import { StayService } from "./stay.service";

@ApiTags("host-stay")
@ApiCookieAuth()
@UseGuards(HostGuard)
@Controller("host")
export class HostStayController {
  constructor(
    private readonly stay: StayService,
    private readonly bookings: BookingsService,
    private readonly lifecycle: StayLifecycleWorker,
    private readonly notifications: NotificationWorker,
  ) {}

  @Get("properties/:id/stay-information")
  @ApiOperation({
    summary: "Informacje dla gościa",
    description: "Konfigurowane raz dla obiektu, nie kopiowane do każdej rezerwacji.",
  })
  @ApiOkResponse({ type: StayInformationDto })
  @ApiNotFoundResponse({ description: "Obiekt nie istnieje albo nie należy do gospodarza" })
  async stayInformation(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) propertyId: string,
  ): Promise<StayInformationDto> {
    return this.stay.stayInformationFor(host.id, propertyId);
  }

  @Put("properties/:id/stay-information")
  @ApiOperation({
    summary: "Zapis informacji dla gościa",
    description:
      "Godziny są lokalne dla obiektu. Zmiana przelicza zaplanowane powiadomienia dla nadchodzących rezerwacji.",
  })
  @ApiOkResponse({ type: StayInformationDto })
  async saveStayInformation(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateStayInformationDto,
  ): Promise<StayInformationDto> {
    const saved = await this.stay.saveStayInformation(host.id, propertyId, dto);
    // Check-in time and offset both move the schedule, so it is rebuilt.
    await this.reschedule(propertyId);
    return saved;
  }

  @Get("properties/:id/sensitive-access")
  @ApiOperation({
    summary: "Dane dostępu do obiektu",
    description: "Przechowywane zaszyfrowane. Gospodarz widzi własne dane w czytelnej formie.",
  })
  @ApiOkResponse({ type: SensitiveAccessDto })
  async sensitiveAccess(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) propertyId: string,
  ): Promise<SensitiveAccessDto> {
    return this.stay.sensitiveAccessFor(host.id, propertyId);
  }

  @Put("properties/:id/sensitive-access")
  @ApiOperation({ summary: "Zapis danych dostępu" })
  @ApiOkResponse({ type: SensitiveAccessDto })
  async saveSensitiveAccess(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateSensitiveAccessDto,
  ): Promise<SensitiveAccessDto> {
    const saved = await this.stay.saveSensitiveAccess(host.id, propertyId, dto);
    await this.reschedule(propertyId);
    return saved;
  }

  @Get("bookings/:id/sensitive-access")
  @ApiOperation({ summary: "Kiedy gość zobaczy dane dostępu" })
  @ApiOkResponse({ type: BookingAccessStatusDto })
  async bookingAccess(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) bookingId: string,
  ): Promise<BookingAccessStatusDto> {
    const { booking } = await this.bookings.findForHost(host.id, bookingId);
    return this.stay.accessStatusFor(booking);
  }

  /**
   * Hands the access details to this Guest now.
   *
   * Scoped to one Booking: the Property's default reveal offset is deliberately
   * left alone, so the next Guest still gets the Host's normal timing
   * (milestone 09 §20A).
   */
  @Post("bookings/:id/sensitive-access/reveal")
  @HttpCode(200)
  @ApiOperation({
    summary: "Udostępnij dane dostępu teraz",
    description:
      "Działa tylko dla tej rezerwacji i nie zmienia domyślnego ustawienia obiektu. Powtórne wywołanie niczego nie zmienia ani nie wysyła drugiego emaila.",
  })
  @ApiOkResponse({ type: BookingAccessStatusDto })
  @ApiConflictResponse({ description: "BOOKING_NOT_CONFIRMED" })
  async reveal(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) bookingId: string,
  ): Promise<BookingAccessStatusDto> {
    const { booking } = await this.bookings.findForHost(host.id, bookingId);

    if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
      throw new BookingNotConfirmedError();
    }

    const result = await this.stay.revealForBooking(booking.id);

    // Only the first call writes the trail and mails the Guest.
    if (result.revealed) {
      await this.bookings.recordPaymentEvent(booking.id, "SENSITIVE_ACCESS_REVEALED", {
        revealedBy: "HOST",
      });
      await this.notifications.enqueue(booking.id, "SENSITIVE_ACCESS_READY");
    }

    const fresh = await this.bookings.findByIdInternal(booking.id);
    return this.stay.accessStatusFor(fresh);
  }

  /** Rebuilds the schedule for every upcoming Booking of a Property. */
  private async reschedule(propertyId: string): Promise<void> {
    for (const bookingId of await this.bookings.upcomingConfirmedIds(propertyId)) {
      await this.lifecycle.scheduleFor(bookingId);
    }
  }
}

/** Access details belong to a Stay that is actually going to happen. */
export class BookingNotConfirmedError extends ConflictException {
  constructor() {
    super({
      code: "BOOKING_NOT_CONFIRMED",
      message: "Dane dostępu można udostępnić dopiero po potwierdzeniu rezerwacji.",
    });
  }
}
