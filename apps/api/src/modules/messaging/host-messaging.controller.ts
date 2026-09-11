import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentHost, CurrentUser, HostGuard } from "../auth/auth.guards";
import type { SessionUser } from "../auth/sessions.service";
import type { HostRow } from "../../infrastructure/database/schema";
import { BookingsService } from "../bookings/bookings.service";
import { MessageDto, MessagesPageDto, MessagesQueryDto, SendMessageDto } from "./dto/message.dto";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { MessagingService } from "./messaging.service";

/**
 * The Host side of the same conversation. Ownership is resolved from the
 * session, never from the request body: a Host can only ever reach Bookings of
 * their own Properties (milestone 09 §29).
 */
@ApiTags("host-messaging")
@ApiCookieAuth()
@UseGuards(HostGuard, RateLimitGuard)
@Controller("host/bookings")
export class HostMessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly bookings: BookingsService,
  ) {}

  @Get(":id/messages")
  @ApiOperation({ summary: "Rozmowa z gościem" })
  @ApiOkResponse({ type: MessagesPageDto })
  @ApiNotFoundResponse({ description: "Rezerwacja nie należy do tego gospodarza" })
  async messages(
    @CurrentHost() host: HostRow,
    @Param("id", ParseUUIDPipe) bookingId: string,
    @Query() query: MessagesQueryDto,
  ): Promise<MessagesPageDto> {
    await this.bookings.findForHost(host.id, bookingId);
    return this.messaging.history(bookingId, "HOST", query);
  }

  @RateLimit({
    bucket: "message-send",
    limit: 30,
    windowSeconds: 60,
    scope: "user",
  })
  @Post(":id/messages")
  @ApiOperation({ summary: "Wiadomość do gościa" })
  @ApiCreatedResponse({ type: MessageDto })
  @ApiConflictResponse({ description: "CONVERSATION_CLOSED" })
  async send(
    @CurrentHost() host: HostRow,
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) bookingId: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageDto> {
    const { booking } = await this.bookings.findForHost(host.id, bookingId);
    return this.messaging.send(booking, { type: "HOST", userId: user.id }, dto.body);
  }
}
