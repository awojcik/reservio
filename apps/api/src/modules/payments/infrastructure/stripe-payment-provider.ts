import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";

import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreateRefundInput,
  type CreateTransferInput,
  type CreateTransferReversalInput,
  type PaymentProvider,
  type ProviderAccount,
  type ProviderEvent,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderPayout,
  type ProviderRefund,
  type ProviderTransfer,
  type ProviderTransferReversal,
} from "../domain/payment-provider";

export const STRIPE_CLIENT = Symbol("STRIPE_CLIENT");

/**
 * Stripe's own statuses, reduced to the five the domain recognises.
 *
 * `requires_action` is emphatically *not* a failure — it is a 3-D Secure
 * challenge in progress, and treating it as final would decline every SCA
 * payment in Europe (milestone 08 §16).
 */
function toDomainStatus(status: Stripe.PaymentIntent.Status): ProviderPaymentStatus {
  switch (status) {
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "CANCELLED";
    case "requires_action":
    case "requires_confirmation":
      return "REQUIRES_ACTION";
    case "processing":
    case "requires_payment_method":
    case "requires_capture":
      return "PROCESSING";
    default:
      return "PROCESSING";
  }
}

/** Statuses from which Stripe still allows a cancel. */
const CANCELLABLE: Stripe.PaymentIntent.Status[] = [
  "requires_payment_method",
  "requires_capture",
  "requires_confirmation",
  "requires_action",
  "processing",
];

/** Stripe's payout statuses, reduced to the five the domain recognises. */
function toProviderPayout(
  payout: Stripe.Payout,
  providerAccountId: string | null,
): ProviderPayout {
  const status: ProviderPayout["status"] =
    payout.status === "paid"
      ? "PAID"
      : payout.status === "in_transit"
        ? "IN_TRANSIT"
        : payout.status === "failed"
          ? "FAILED"
          : payout.status === "canceled"
            ? "CANCELLED"
            : "PENDING";

  return {
    providerPayoutId: payout.id,
    providerAccountId,
    amountMinor: payout.amount,
    currency: payout.currency.toUpperCase(),
    status,
    arrivalAt: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
    failureCode: payout.failure_code ?? null,
    failureMessage: payout.failure_message ?? null,
  };
}

function readinessOf(account: Stripe.Account): ProviderAccount {
  return {
    providerAccountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
  };
}

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;
  private readonly logger = new Logger(StripePaymentProvider.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {}

  private get webhookSecret(): string {
    const secret = this.config.get<string>("STRIPE_WEBHOOK_SECRET")?.trim();
    if (!secret) {
      throw new PaymentProviderError("Brak STRIPE_WEBHOOK_SECRET.", "CONFIG_MISSING");
    }
    return secret;
  }

  /**
   * Creates the PaymentIntent, or returns the one this Payment already owns.
   *
   * The idempotency key is derived from our own Payment id, so a retried
   * request — a dropped response, a double click, a worker replay — reaches
   * the same PaymentIntent rather than opening a second one (milestone 08 §11).
   */
  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          // Elements decides the method; Rezervio never sees card details.
          automatic_payment_methods: { enabled: true },
          metadata: input.metadata,
        },
        { idempotencyKey: `payment-create:${input.paymentId}` },
      );

      return this.toProviderPayment(intent);
    } catch (error) {
      throw this.wrap(error, "Nie udało się rozpocząć płatności.");
    }
  }

  async cancelPayment(providerPaymentId: string, paymentId: string): Promise<void> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId);
      // Best effort: a PaymentIntent that already succeeded is refunded, not
      // cancelled, and one already cancelled needs nothing (milestone 08 §27).
      if (!CANCELLABLE.includes(intent.status)) return;

      await this.stripe.paymentIntents.cancel(providerPaymentId, undefined, {
        idempotencyKey: `payment-cancel:${paymentId}`,
      });
    } catch (error) {
      throw this.wrap(error, "Nie udało się anulować płatności u dostawcy.");
    }
  }

  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amountMinor,
        },
        { idempotencyKey: `refund:${input.refundId}` },
      );

      return {
        providerRefundId: refund.id,
        status:
          refund.status === "succeeded"
            ? "SUCCEEDED"
            : refund.status === "failed" || refund.status === "canceled"
              ? "FAILED"
              : "PROCESSING",
        failureCode: refund.failure_reason ?? null,
      };
    } catch (error) {
      throw this.wrap(error, "Nie udało się zlecić zwrotu.");
    }
  }

  /**
   * The signature check is the entire security of the webhook: without it the
   * endpoint would let anyone on the internet confirm a Booking
   * (milestone 08 §17).
   */
  verifyEvent(rawBody: Buffer, signature: string | undefined): ProviderEvent {
    if (!signature) {
      throw new PaymentProviderError("Brak nagłówka podpisu.", "SIGNATURE_MISSING");
    }

    // Read outside the try: a missing secret is a deployment mistake, and
    // reporting it as a bad signature would send anyone debugging it hunting
    // for a problem on the provider's side.
    const secret = this.webhookSecret;

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      // The message can carry the payload; only the outcome is safe to keep.
      throw new PaymentProviderError("Nieprawidłowy podpis.", "SIGNATURE_INVALID");
    }

    return this.toProviderEvent(event);
  }

  async createConnectedAccount(input: {
    hostId: string;
    email: string;
  }): Promise<ProviderAccount> {
    try {
      const account = await this.stripe.accounts.create(
        {
          type: "express",
          email: input.email,
          // Onboarding, identity checks and KYC stay with the provider.
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { hostId: input.hostId },
        },
        { idempotencyKey: `connect-account:${input.hostId}` },
      );

      return readinessOf(account);
    } catch (error) {
      throw this.wrap(error, "Nie udało się utworzyć konta rozliczeniowego.");
    }
  }

  async createOnboardingLink(input: {
    providerAccountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    try {
      const link = await this.stripe.accountLinks.create({
        account: input.providerAccountId,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: "account_onboarding",
      });

      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
    } catch (error) {
      throw this.wrap(error, "Nie udało się przygotować linku do konfiguracji.");
    }
  }

  async getAccount(providerAccountId: string): Promise<ProviderAccount> {
    try {
      return readinessOf(await this.stripe.accounts.retrieve(providerAccountId));
    } catch (error) {
      throw this.wrap(error, "Nie udało się odczytać stanu konta rozliczeniowego.");
    }
  }

  /**
   * Moves money from the platform balance to the Host's connected account.
   *
   * The idempotency key is derived from our own Transfer id, so a retried job
   * — a lost response, a duplicate worker — reaches the same Stripe transfer
   * instead of paying the Host twice (milestone 10 §15).
   */
  async createTransfer(input: CreateTransferInput): Promise<ProviderTransfer> {
    try {
      const transfer = await this.stripe.transfers.create(
        {
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          destination: input.providerAccountId,
          metadata: input.metadata,
        },
        { idempotencyKey: `settlement-transfer:${input.transferId}` },
      );

      return { providerTransferId: transfer.id, status: "SUCCEEDED" };
    } catch (error) {
      throw this.wrap(error, "Nie udało się przekazać środków gospodarzowi.");
    }
  }

  async getTransfer(providerTransferId: string): Promise<ProviderTransfer | null> {
    try {
      const transfer = await this.stripe.transfers.retrieve(providerTransferId);
      return {
        providerTransferId: transfer.id,
        // Stripe transfers are immediate; what varies is whether they were
        // later reversed.
        status: transfer.reversed ? "FAILED" : "SUCCEEDED",
      };
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeError &&
        error.code === "resource_missing"
      ) {
        return null;
      }
      throw this.wrap(error, "Nie udało się odczytać stanu przelewu.");
    }
  }

  async createTransferReversal(
    input: CreateTransferReversalInput,
  ): Promise<ProviderTransferReversal> {
    try {
      const reversal = await this.stripe.transfers.createReversal(
        input.providerTransferId,
        { amount: input.amountMinor },
        { idempotencyKey: `transfer-reversal:${input.reversalId}` },
      );

      return { providerReversalId: reversal.id, status: "SUCCEEDED" };
    } catch (error) {
      throw this.wrap(error, "Nie udało się cofnąć przelewu.");
    }
  }

  /**
   * Payouts are observed, never initiated. An Express account on Stripe's
   * default schedule pays itself out; forcing a platform-triggered payout
   * would be working around the provider rather than with it
   * (milestone 10 §17).
   */
  async listPayouts(providerAccountId: string, limit: number): Promise<ProviderPayout[]> {
    try {
      const payouts = await this.stripe.payouts.list(
        { limit },
        { stripeAccount: providerAccountId },
      );

      return payouts.data.map((payout) => toProviderPayout(payout, providerAccountId));
    } catch (error) {
      throw this.wrap(error, "Nie udało się odczytać wypłat.");
    }
  }

  private toProviderPayment(intent: Stripe.PaymentIntent): ProviderPayment {
    if (!intent.client_secret) {
      throw new PaymentProviderError(
        "Dostawca nie zwrócił danych do potwierdzenia płatności.",
        "CLIENT_SECRET_MISSING",
      );
    }

    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret,
      status: toDomainStatus(intent.status),
    };
  }

  private toProviderEvent(event: Stripe.Event): ProviderEvent {
    const base = { id: event.id, type: event.type };

    if (event.type.startsWith("payment_intent.")) {
      const intent = event.data.object as Stripe.PaymentIntent;
      const error = intent.last_payment_error;

      return {
        ...base,
        payment: {
          providerPaymentId: intent.id,
          amountMinor: intent.amount,
          currency: intent.currency.toUpperCase(),
          status:
            event.type === "payment_intent.payment_failed"
              ? "FAILED"
              : toDomainStatus(intent.status),
          failureCode: error?.code ?? error?.decline_code ?? null,
          // Stripe's own message is Guest-safe: it never contains card data.
          failureMessage: error?.message ?? null,
        },
      };
    }

    if (event.type === "account.updated") {
      return { ...base, account: readinessOf(event.data.object as Stripe.Account) };
    }

    if (event.type.startsWith("transfer.")) {
      const transfer = event.data.object as Stripe.Transfer;
      return {
        ...base,
        transfer: {
          providerTransferId: transfer.id,
          amountMinor: transfer.amount,
          currency: transfer.currency.toUpperCase(),
          reversed: transfer.reversed,
        },
      };
    }

    if (event.type.startsWith("payout.")) {
      const payout = event.data.object as Stripe.Payout;
      // `event.account` is the connected account the payout belongs to.
      return {
        ...base,
        payout: toProviderPayout(payout, event.account ?? null),
      };
    }

    return base;
  }

  /** Keeps Stripe's exception shape out of everything above this class. */
  private wrap(error: unknown, message: string): PaymentProviderError {
    if (error instanceof Stripe.errors.StripeError) {
      this.logger.warn({
        event: "payment.provider_error",
        type: error.type,
        code: error.code ?? null,
      });

      const retryable =
        error.type === "StripeConnectionError" || error.type === "StripeAPIError";
      return new PaymentProviderError(message, error.code ?? error.type, retryable);
    }

    this.logger.error({ event: "payment.provider_error", type: "unknown" });
    return new PaymentProviderError(message, null, true);
  }
}
