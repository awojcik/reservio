import { createHmac, randomUUID } from "node:crypto";

import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreateRefundInput,
  type PaymentProvider,
  type ProviderAccount,
  type ProviderEvent,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderPayout,
  type ProviderRefund,
  type ProviderTransfer,
  type ProviderTransferReversal,
  type CreateTransferInput,
  type CreateTransferReversalInput,
} from "../../src/modules/payments/domain/payment-provider";

export const FAKE_WEBHOOK_SECRET = "whsec_test_rezervio";

/**
 * Stand-in for Stripe.
 *
 * Automated tests must not depend on a live PSP, and everything the milestone
 * demands proof of — duplicate events, a late success, a decline, an amount
 * mismatch — is far easier to arrange here than against a sandbox. The signing
 * scheme mirrors Stripe's shape (`t=…,v1=…` over `timestamp.body`) so the
 * signature check being exercised is a real one, not a stub that returns true.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;

  readonly created: CreatePaymentInput[] = [];
  readonly refunds: CreateRefundInput[] = [];
  readonly cancelled: string[] = [];
  readonly accountsCreated: string[] = [];

  /** Idempotency: the same paymentId must map to the same intent. */
  private readonly intents = new Map<string, string>();
  private refundOutcome: ProviderRefund["status"] = "SUCCEEDED";
  private refundFailures = 0;
  private accountFlags = {
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  };

  failRefunds(times: number): void {
    this.refundFailures = times;
  }

  setRefundOutcome(status: ProviderRefund["status"]): void {
    this.refundOutcome = status;
  }

  setAccountFlags(flags: Partial<typeof this.accountFlags>): void {
    this.accountFlags = { ...this.accountFlags, ...flags };
  }

  createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    this.created.push(input);

    const existing = this.intents.get(input.paymentId);
    const providerPaymentId = existing ?? `pi_${randomUUID().replace(/-/g, "")}`;
    this.intents.set(input.paymentId, providerPaymentId);

    return Promise.resolve({
      providerPaymentId,
      clientSecret: `${providerPaymentId}_secret_test`,
      status: "PROCESSING",
    });
  }

  cancelPayment(providerPaymentId: string): Promise<void> {
    this.cancelled.push(providerPaymentId);
    return Promise.resolve();
  }

  createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    this.refunds.push(input);

    if (this.refundFailures > 0) {
      this.refundFailures -= 1;
      return Promise.reject(
        new PaymentProviderError("Chwilowy błąd dostawcy.", "TEMPORARY", true),
      );
    }

    return Promise.resolve({
      providerRefundId: `re_${input.refundId.slice(0, 12)}`,
      status: this.refundOutcome,
    });
  }

  verifyEvent(rawBody: Buffer, signature: string | undefined): ProviderEvent {
    if (!signature) {
      throw new PaymentProviderError("Brak nagłówka podpisu.", "SIGNATURE_MISSING");
    }

    const match = /^t=(\d+),v1=([a-f0-9]+)$/.exec(signature);
    if (!match) {
      throw new PaymentProviderError("Nieprawidłowy podpis.", "SIGNATURE_INVALID");
    }

    const expected = sign(match[1], rawBody);
    if (expected !== match[2]) {
      throw new PaymentProviderError("Nieprawidłowy podpis.", "SIGNATURE_INVALID");
    }

    return JSON.parse(rawBody.toString("utf8")) as ProviderEvent;
  }

  createConnectedAccount(input: { hostId: string }): Promise<ProviderAccount> {
    this.accountsCreated.push(input.hostId);
    return Promise.resolve({
      providerAccountId: `acct_${input.hostId.slice(0, 12)}`,
      ...this.accountFlags,
    });
  }

  createOnboardingLink(input: {
    providerAccountId: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    return Promise.resolve({
      url: `https://connect.example.test/onboarding/${input.providerAccountId}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  getAccount(providerAccountId: string): Promise<ProviderAccount> {
    return Promise.resolve({ providerAccountId, ...this.accountFlags });
  }

  // ---- settlement payouts ----

  readonly transfers: CreateTransferInput[] = [];
  readonly reversals: CreateTransferReversalInput[] = [];
  private transferFailures = 0;
  private transferOutcome: ProviderTransfer["status"] = "SUCCEEDED";
  private payouts: ProviderPayout[] = [];
  /** Lets a test say the provider disagrees with our local record. */
  private readonly transferState = new Map<string, ProviderTransfer["status"]>();

  failTransfers(times: number): void {
    this.transferFailures = times;
  }

  setTransferOutcome(status: ProviderTransfer["status"]): void {
    this.transferOutcome = status;
  }

  setPayouts(payouts: ProviderPayout[]): void {
    this.payouts = payouts;
  }

  /** Pretends the provider already completed a transfer we lost track of. */
  setProviderTransferStatus(id: string, status: ProviderTransfer["status"]): void {
    this.transferState.set(id, status);
  }

  createTransfer(input: CreateTransferInput): Promise<ProviderTransfer> {
    this.transfers.push(input);

    if (this.transferFailures > 0) {
      this.transferFailures -= 1;
      return Promise.reject(
        new PaymentProviderError("Chwilowy błąd dostawcy.", "TEMPORARY", true),
      );
    }

    // Same idempotency contract as Stripe: one id, one transfer.
    const providerTransferId = `tr_${input.transferId.slice(0, 12).replace(/-/g, "")}`;
    this.transferState.set(providerTransferId, this.transferOutcome);

    return Promise.resolve({ providerTransferId, status: this.transferOutcome });
  }

  getTransfer(providerTransferId: string): Promise<ProviderTransfer | null> {
    const status = this.transferState.get(providerTransferId);
    return Promise.resolve(status ? { providerTransferId, status } : null);
  }

  createTransferReversal(
    input: CreateTransferReversalInput,
  ): Promise<ProviderTransferReversal> {
    this.reversals.push(input);
    return Promise.resolve({
      providerReversalId: `trr_${input.reversalId.slice(0, 12).replace(/-/g, "")}`,
      status: "SUCCEEDED",
    });
  }

  listPayouts(): Promise<ProviderPayout[]> {
    return Promise.resolve(this.payouts);
  }

  /** Clears the recorded calls, so a test can assert on its own activity. */
  reset(): void {
    this.created.length = 0;
    this.refunds.length = 0;
    this.cancelled.length = 0;
    this.accountsCreated.length = 0;
    this.transfers.length = 0;
    this.reversals.length = 0;
    this.transferFailures = 0;
    this.refundFailures = 0;
    this.transferOutcome = "SUCCEEDED";
    this.refundOutcome = "SUCCEEDED";
    this.payouts = [];
  }

  /** The provider payment id a given Payment ended up with. */
  intentFor(paymentId: string): string | undefined {
    return this.intents.get(paymentId);
  }
}

function sign(timestamp: string, body: Buffer): string {
  return createHmac("sha256", FAKE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex");
}

/** Builds a signed webhook request body and header, the way Stripe would. */
export function signedEvent(event: {
  id: string;
  type: string;
  payment?: {
    providerPaymentId: string;
    amountMinor: number;
    currency: string;
    status: ProviderPaymentStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  };
  account?: ProviderAccount;
}): { payload: string; signature: string } {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    payload,
    signature: `t=${timestamp},v1=${sign(timestamp, Buffer.from(payload, "utf8"))}`,
  };
}
