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
import { PaymentIntentDto } from "./dto/payment.dto";
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
}
