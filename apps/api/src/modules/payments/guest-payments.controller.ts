import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import {
  GuestAccessService,
  guestTokenFrom,
  type CookieRequest,
} from "../bookings/guest-access.service";
import {
  RateLimit,
  RateLimitGuard,
} from "../../infrastructure/security/rate-limit.guard";
import { PaymentIntentDto, PaymentSyncDto } from "./dto/payment.dto";
import { PaymentsService } from "./payments.service";

@ApiTags("payments")
@UseGuards(RateLimitGuard)
@Controller("bookings")
export class GuestPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly guestAccess: GuestAccessService,
  ) {}

  /**
   * Starts paying for a Booking.
   *
   * Requires Guest access, exactly like reading the Booking does: the public
   * reference is printed in emails and quoted over the phone, so it identifies
   * a Booking without authorising anything (milestone 08 §10).
   */
  /*
   * Keyed by Booking, not by address: a Guest retrying a declined card is
   * legitimate and frequent, while a hundred attempts against one Booking is
   * not (milestone 11 §20).
   */
  @RateLimit({
    bucket: "payment-create",
    limit: 20,
    windowSeconds: 300,
    scope: "route-param",
    param: "reference",
  })
  @Post(":reference/payment")
  @HttpCode(200)
  @ApiOperation({
    summary: "Rozpoczęcie płatności",
    description:
      "Tworzy albo wznawia płatność za rezerwację oczekującą na zapłatę. Kwota pochodzi wyłącznie ze snapshotu rezerwacji — dane z przeglądarki są ignorowane.",
  })
  @ApiOkResponse({ type: PaymentIntentDto })
  @ApiConflictResponse({
    description: "BOOKING_HOLD_EXPIRED albo BOOKING_NOT_PAYABLE",
  })
  @ApiUnauthorizedResponse({ description: "Brak ważnego dostępu gościa" })
  async start(
    @Param("reference") reference: string,
    @Req() request: FastifyRequest & CookieRequest,
  ): Promise<PaymentIntentDto> {
    const token = guestTokenFrom(request);
    if (!token) {
      throw new UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
    }

    const bookingId = await this.guestAccess.verify(reference, token);
    const started = await this.payments.startPayment(bookingId);

    return {
      paymentId: started.paymentId,
      clientSecret: started.clientSecret,
      status: started.status,
      amountMinor: started.amountMinor,
      currency: started.currency,
      expiresAt: started.expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * "I have finished confirming — go and look."
   *
   * The browser cannot confirm a Booking and this endpoint does not let it:
   * nothing in the request body is read, because there is no body. All it does
   * is make Rezervio ask the provider directly, and the provider's answer runs
   * through the same state machine the signed webhook runs through.
   *
   * It exists because a webhook is a push. It can arrive minutes late, it can
   * be lost, and against a machine with no public address it never arrives —
   * while the hold keeps counting down. Without a pull the Guest's card is
   * charged and their Booking expires anyway (milestone 08 §4, §16, §23).
   */
  @RateLimit({
    bucket: "payment-sync",
    limit: 60,
    windowSeconds: 300,
    scope: "route-param",
    param: "reference",
  })
  @Post(":reference/payment/sync")
  @HttpCode(200)
  @ApiOperation({
    summary: "Uzgodnienie płatności z dostawcą",
    description:
      "Pyta dostawcę o rzeczywisty stan płatności i stosuje go tak samo jak podpisany webhook. Przeglądarka niczego tu nie stwierdza — prosi jedynie o sprawdzenie.",
  })
  @ApiOkResponse({ type: PaymentSyncDto })
  @ApiUnauthorizedResponse({ description: "Brak ważnego dostępu gościa" })
  async sync(
    @Param("reference") reference: string,
    @Req() request: FastifyRequest & CookieRequest,
  ): Promise<PaymentSyncDto> {
    const token = guestTokenFrom(request);
    if (!token) {
      throw new UnauthorizedException("Otwórz rezerwację linkiem z wiadomości email.");
    }

    const bookingId = await this.guestAccess.verify(reference, token);
    return this.payments.syncPayment(bookingId);
  }
}
