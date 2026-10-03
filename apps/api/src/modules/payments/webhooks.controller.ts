import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { PaymentProviderError } from "./domain/payment-provider";
import { WebhookAckDto } from "./dto/payment.dto";
import { PaymentsService } from "./payments.service";

/** Set by the raw-body content type parser registered in `bootstrap.ts`. */
type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

@ApiTags("payments")
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * The provider's callback, and the only way a Booking becomes CONFIRMED.
   *
   * Deliberately session-free: the caller is Stripe, not a browser. What
   * authorises it is the signature over the raw body — without that check this
   * endpoint would let anyone on the internet confirm a Booking for free
   * (milestone 08 §17).
   */
  @Post("stripe")
  @HttpCode(200)
  @ApiOperation({
    summary: "Webhook Stripe",
    description:
      "Weryfikuje podpis na surowym ciele żądania. Powtórzone zdarzenie zwraca 200 i nie wywołuje drugiego efektu.",
  })
  @ApiOkResponse({ type: WebhookAckDto })
  async stripe(
    @Req() request: RawBodyRequest,
    @Headers("stripe-signature") signature?: string,
  ): Promise<WebhookAckDto> {
    if (!request.rawBody) {
      throw new BadRequestException("Brak treści żądania.");
    }

    try {
      const result = await this.payments.handleWebhook(request.rawBody, signature);
      return { received: true, duplicate: result.duplicate };
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        // 400, never 401: a rejected signature must not look like a session
        // problem, and the reason never echoes the payload.
        throw new BadRequestException({
          code: error.code ?? "WEBHOOK_REJECTED",
          message: "Nie udało się zweryfikować zdarzenia.",
        });
      }
      throw error;
    }
  }
}
