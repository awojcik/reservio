import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { BookingsService } from "../bookings/bookings.service";
import {
  GuestAccessService,
  guestTokenFrom,
  type CookieRequest,
} from "../bookings/guest-access.service";
import { SessionsService } from "../auth/sessions.service";
import { StayDetailsDto } from "../stay/dto/stay.dto";
import { StayService } from "../stay/stay.service";
import { MessageDto, MessagesPageDto, MessagesQueryDto, SendMessageDto } from "./dto/message.dto";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { MessagingService } from "./messaging.service";

type Request = FastifyRequest & CookieRequest;

/**
 * The Guest side of a Stay: what they need to know, and how they reach the
 * Host. Both require proof of access to this specific Booking — the public
 * reference identifies it but authorises nothing (milestone 09 §41, §43).
 */
@ApiTags("stay")
@UseGuards(RateLimitGuard)
@Controller("bookings")
export class GuestStayController {
  constructor(
    private readonly stay: StayService,
    private readonly messaging: MessagingService,
    private readonly bookings: BookingsService,
    private readonly guestAccess: GuestAccessService,
    private readonly sessions: SessionsService,
  ) {}

  @Get(":reference/stay")
  @ApiOperation({
    summary: "Szczegóły pobytu",
    description:
      "Godziny, instrukcje i stan danych dostępu. Sekret pojawia się w odpowiedzi dopiero po terminie udostępnienia — frontend niczego nie ukrywa.",
  })
  @ApiOkResponse({ type: StayDetailsDto })
  @ApiUnauthorizedResponse({ description: "Brak ważnego dostępu gościa" })
  async stayDetails(
    @Param("reference") reference: string,
    @Req() request: Request,
  ): Promise<StayDetailsDto> {
    const bookingId = await this.authorise(reference, request);
    return this.stay.detailsFor(bookingId);
  }

  @Get(":reference/messages")
  @ApiOperation({
    summary: "Rozmowa z gospodarzem",
    description: "Kursorowa paginacja: najnowsze najpierw, starsze na żądanie.",
  })
  @ApiOkResponse({ type: MessagesPageDto })
  async messages(
    @Param("reference") reference: string,
    @Query() query: MessagesQueryDto,
    @Req() request: Request,
  ): Promise<MessagesPageDto> {
    const bookingId = await this.authorise(reference, request);
    return this.messaging.history(bookingId, "GUEST", query);
  }

  @RateLimit({
    bucket: "message-send",
    limit: 30,
    windowSeconds: 60,
    scope: "route-param",
    param: "reference",
  })
  @Post(":reference/messages")
  @ApiOperation({ summary: "Wiadomość do gospodarza" })
  @ApiCreatedResponse({ type: MessageDto })
  @ApiConflictResponse({ description: "CONVERSATION_CLOSED" })
  async send(
    @Param("reference") reference: string,
    @Body() dto: SendMessageDto,
    @Req() request: Request,
  ): Promise<MessageDto> {
    const bookingId = await this.authorise(reference, request);
    const booking = await this.bookings.findByIdInternal(bookingId);

    // Recorded when there is an account behind the Guest; null otherwise, and
    // booking without one has to keep working (milestone 09 §27).
    const user = await this.currentUser(request);

    return this.messaging.send(
      booking,
      { type: "GUEST", userId: user?.id ?? null },
      dto.body,
    );
  }

  /**
   * Two ways in, and no third: the account the Booking belongs to, or a valid
   * Guest access token.
   */
  private async authorise(reference: string, request: Request): Promise<string> {
    const token = guestTokenFrom(request);
    if (token) return this.guestAccess.verify(reference, token);

    const user = await this.currentUser(request);
    if (user) {
      const booking = await this.bookings.findByReference(reference);
      if (booking.booking.guestUserId === user.id) return booking.booking.id;
    }

    throw new UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
  }

  private async currentUser(request: Request): Promise<{ id: string } | null> {
    const sessionToken = request.cookies?.[this.sessions.cookieName];
    if (!sessionToken) return null;

    const user = await this.sessions.resolve(sessionToken);
    return user ? { id: user.id } : null;
  }
}
