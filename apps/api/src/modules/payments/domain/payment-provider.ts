/**
 * The boundary between Rezervio and whoever moves the money.
 *
 * The domain must not depend on Stripe: a Booking is confirmed because a
 * payment succeeded, not because a particular vendor said a particular word
 * (milestone 08 §2). Deliberately small — this is a seam, not a multi-PSP
 * framework.
 */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export type CreatePaymentInput = {
  /** Our Payment id. Also the provider idempotency key, so retries are free. */
  paymentId: string;
  amountMinor: number;
  currency: string;
  /** Only ids — never Guest contact details (milestone 08 §13). */
  metadata: { bookingId: string; paymentId: string; bookingReference: string };
};

export type ProviderPayment = {
  providerPaymentId: string;
  /** Handed to the browser so Stripe Elements can confirm it. Never logged. */
  clientSecret: string;
  status: ProviderPaymentStatus;
};

/**
 * What the provider currently believes about a payment we already created.
 *
 * Deliberately *not* a `ProviderPayment`: there is no `clientSecret` here,
 * because the point of asking is to learn an outcome, not to hand the browser
 * another chance to confirm. It carries the amount for the same reason the
 * webhook does — the figure is checked against our own snapshot before a
 * Booking is confirmed.
 */
export type ProviderPaymentState = {
  providerPaymentId: string;
  status: ProviderPaymentStatus;
  amountMinor: number;
  currency: string;
  failureCode?: string | null;
  failureMessage?: string | null;
};

/**
 * The provider's outcome, already reduced to what the domain cares about.
 * Mapping happens in the adapter so no Stripe vocabulary leaks inwards.
 */
export type ProviderPaymentStatus =
  | "PROCESSING"
  | "REQUIRES_ACTION"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type CreateRefundInput = {
  refundId: string;
  providerPaymentId: string;
  amountMinor: number;
};

export type ProviderRefund = {
  providerRefundId: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  failureCode?: string | null;
  failureMessage?: string | null;
};

/**
 * Money moving from the platform balance to a Host's connected account.
 * Separate from the Payment on purpose: the Guest pays the platform, and the
 * Host is paid later (milestone 10 §1).
 */
export type CreateTransferInput = {
  /** Our Transfer id. Also the provider idempotency key. */
  transferId: string;
  providerAccountId: string;
  amountMinor: number;
  currency: string;
  /** Ids only — nothing about the Guest travels to the provider here. */
  metadata: { settlementId: string; bookingId: string; hostId: string };
};

export type ProviderTransfer = {
  providerTransferId: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  failureCode?: string | null;
  failureMessage?: string | null;
};

export type CreateTransferReversalInput = {
  reversalId: string;
  providerTransferId: string;
  amountMinor: number;
};

export type ProviderTransferReversal = {
  providerReversalId: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
};

/** A payout the provider made from a connected account to a bank. */
export type ProviderPayout = {
  providerPayoutId: string;
  providerAccountId: string | null;
  amountMinor: number;
  currency: string;
  status: "PENDING" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELLED";
  arrivalAt: Date | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

/** What a verified provider event carries, once the signature has been checked. */
export type ProviderEvent = {
  id: string;
  type: string;
  /** Only for payment events; absent for account events. */
  payment?: {
    providerPaymentId: string;
    amountMinor: number;
    currency: string;
    status: ProviderPaymentStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  };
  account?: ProviderAccount;
  transfer?: {
    providerTransferId: string;
    amountMinor: number;
    currency: string;
    reversed: boolean;
  };
  payout?: ProviderPayout;
};

export type ProviderAccount = {
  providerAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    /** Whether trying again later could plausibly work. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export interface PaymentProvider {
  readonly name: "STRIPE";

  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;

  /**
   * Asks the provider what actually happened to a payment.
   *
   * The counterpart to `verifyEvent`: a webhook is a push the provider may
   * deliver late, retry for hours, or — behind a laptop with no public address
   * — never deliver at all. This is the pull, and it is the only way the
   * outcome can be established without one. Returns `null` for an intent the
   * provider no longer knows about (milestone 08 §16, §19).
   */
  retrievePayment(providerPaymentId: string): Promise<ProviderPaymentState | null>;

  /**
   * Best-effort cancel. Returns what the intent ended up as, because an intent
   * that already succeeded cannot be cancelled and must never be recorded as
   * though it had been (milestone 08 §27).
   */
  cancelPayment(
    providerPaymentId: string,
    paymentId: string,
  ): Promise<ProviderPaymentState | null>;
  createRefund(input: CreateRefundInput): Promise<ProviderRefund>;

  /**
   * Verifies the signature over the *raw* body and returns the event.
   * Throws when the signature is missing, malformed or does not match — the
   * only thing standing between a webhook endpoint and anyone on the internet.
   */
  verifyEvent(rawBody: Buffer, signature: string | undefined): ProviderEvent;

  // ---- Connect foundation (milestone 08 §28-§30) ----
  createConnectedAccount(input: {
    hostId: string;
    email: string;
  }): Promise<ProviderAccount>;
  createOnboardingLink(input: {
    providerAccountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }>;
  getAccount(providerAccountId: string): Promise<ProviderAccount>;

  // ---- Settlement payouts (milestone 10 §13, §17, §20) ----
  createTransfer(input: CreateTransferInput): Promise<ProviderTransfer>;
  /** Used by reconciliation to ask the provider what really happened. */
  getTransfer(providerTransferId: string): Promise<ProviderTransfer | null>;
  createTransferReversal(
    input: CreateTransferReversalInput,
  ): Promise<ProviderTransferReversal>;
  /** Observation only: Rezervio does not initiate payouts to a Host's bank. */
  listPayouts(providerAccountId: string, limit: number): Promise<ProviderPayout[]>;
}
