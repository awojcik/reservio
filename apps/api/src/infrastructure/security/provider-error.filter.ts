import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { AppErrorCode } from "../../common/app-error";
import { PaymentProviderError } from "../../modules/payments/domain/payment-provider";
import {
  PartnerAccessRequiredError,
  ProviderError,
} from "../../modules/connectivity/domain/provider-errors";
import { currentRequestId } from "./request-context";

/**
 * Turns a payment-provider failure into an answer somebody can act on.
 *
 * Without this the provider adapter's error escapes as a bare 500 with no
 * code, which is the same response as a crash — an operator looking at "the
 * Host cannot finish onboarding" learns nothing from it. A dedicated status
 * and a stable code say *whose* fault the failure was (milestone 11 §15).
 *
 * `502`, not `500`: the request was well formed and Rezervio is healthy; an
 * upstream dependency refused. That distinction is what keeps a provider
 * outage out of our own error budget.
 *
 * The body carries our own Polish message plus the provider's error *code* —
 * never its message, which can quote the request that produced it.
 */
@Catch(PaymentProviderError)
export class PaymentProviderExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PaymentProviderExceptionFilter.name);

  catch(error: PaymentProviderError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    this.logger.warn({
      event: "payment.provider_error",
      requestId: currentRequestId(),
      code: error.code,
      retryable: error.retryable,
    });

    reply.status(HttpStatus.BAD_GATEWAY).send({
      code: AppErrorCode.PAYMENT_PROVIDER_ERROR,
      message: error.message,
      providerCode: error.code,
      retryable: error.retryable,
    });
  }
}

/**
 * The same treatment for an external PMS or channel manager.
 *
 * A separate filter rather than a shared base class: the two provider families
 * have nothing to do with each other, and `retryable` here carries an extra
 * case the payment side does not have — a partner programme Rezervio has not
 * been admitted to, which is a business step rather than a technical failure
 * (milestone 12 §15, §21).
 */
@Catch(ProviderError)
export class InventoryProviderExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InventoryProviderExceptionFilter.name);

  catch(error: ProviderError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const partnerAccess = error instanceof PartnerAccessRequiredError;

    this.logger.warn({
      event: "connectivity.provider_error",
      requestId: currentRequestId(),
      code: error.code,
      retryable: error.retryable,
    });

    /*
     * 503 for a missing partner programme: the request was fine and Rezervio
     * is healthy, but the capability is genuinely not available yet. 502 for
     * everything else — an upstream refused.
     */
    reply.status(partnerAccess ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY).send({
      code: partnerAccess ? AppErrorCode.PARTNER_ACCESS_REQUIRED : AppErrorCode.PROVIDER_ERROR,
      message: error.message,
      providerCode: error.code,
      retryable: error.retryable,
    });
  }
}
