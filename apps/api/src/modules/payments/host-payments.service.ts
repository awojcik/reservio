import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database } from "../../infrastructure/database/connection";
import {
  hostPaymentAccounts,
  type HostPaymentAccountRow,
  type HostPaymentReadiness,
} from "../../infrastructure/database/schema";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderAccount,
} from "./domain/payment-provider";

/**
 * The provider's account flags reduced to the four states a Host is shown.
 *
 * Mirroring the whole provider account object into our schema would make the
 * provider's model our model, and every change on their side a migration on
 * ours (milestone 08 §29).
 */
export function toReadiness(account: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}): HostPaymentReadiness {
  if (account.chargesEnabled && account.payoutsEnabled) return "READY";
  // Details are in, but the provider still withholds a capability: this needs
  // the Host's attention, not another click on "continue".
  if (account.detailsSubmitted) return "RESTRICTED";
  return "NOT_STARTED";
}

export type HostPaymentStatus = {
  provider: string;
  readiness: HostPaymentReadiness;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  connected: boolean;
};

const NOT_CONNECTED: HostPaymentStatus = {
  provider: "STRIPE",
  readiness: "NOT_STARTED",
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  connected: false,
};

/**
 * Stripe Connect, only as far as a Host needs it to be payable.
 *
 * Balances, transfers and payouts are deliberately absent — settlement is
 * milestone 10, and half a payout system is worse than none (milestone 08 §32).
 */
@Injectable()
export class HostPaymentsService {
  private readonly logger = new Logger(HostPaymentsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly config: ConfigService,
  ) {}

  private get webOrigin(): string {
    return (this.config.get<string>("WEB_ORIGIN") ?? "http://localhost:3000").split(",")[0];
  }

  /**
   * Creates the connected account, or returns the one this Host already has.
   *
   * Idempotent by the unique key on (host_id, provider): pressing the button
   * twice must not leave a Host with two accounts, only one of which is ever
   * onboarded (milestone 08 §30).
   */
  async ensureAccount(hostId: string, email: string): Promise<HostPaymentStatus> {
    const existing = await this.accountFor(hostId);
    if (existing) return this.toStatus(existing);

    const account = await this.provider.createConnectedAccount({ hostId, email });

    const [row] = await this.database.db
      .insert(hostPaymentAccounts)
      .values({
        hostId,
        provider: this.provider.name,
        providerAccountId: account.providerAccountId,
        onboardingStatus: toReadiness(account),
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        detailsSubmitted: account.detailsSubmitted,
      })
      .onConflictDoNothing()
      .returning();

    this.logger.log({ event: "host_payments.account_created", hostId });

    // Lost a concurrent create; the winner's row is the account.
    return this.toStatus(row ?? (await this.accountFor(hostId))!);
  }

  /**
   * A provider-hosted onboarding link. Identity checks and KYC stay with the
   * provider — Rezervio never collects them (milestone 08 §30).
   */
  async onboardingLink(
    hostId: string,
    email: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const status = await this.ensureAccount(hostId, email);
    const account = (await this.accountFor(hostId))!;

    const link = await this.provider.createOnboardingLink({
      providerAccountId: account.providerAccountId,
      refreshUrl: `${this.webOrigin}/host/payments?refresh=1`,
      returnUrl: `${this.webOrigin}/host/payments?done=1`,
    });

    if (status.readiness === "NOT_STARTED") {
      await this.database.db
        .update(hostPaymentAccounts)
        .set({ onboardingStatus: "IN_PROGRESS", updatedAt: new Date() })
        .where(eq(hostPaymentAccounts.id, account.id));
    }

    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  }

  /** Re-reads the provider so a Host who just finished onboarding sees it. */
  async refreshStatus(hostId: string): Promise<HostPaymentStatus> {
    const account = await this.accountFor(hostId);
    if (!account) return NOT_CONNECTED;

    const fresh = await this.provider.getAccount(account.providerAccountId);
    await this.applyAccount(fresh);

    return this.toStatus((await this.accountFor(hostId))!);
  }

  /** The stored view, without calling the provider. */
  async status(hostId: string): Promise<HostPaymentStatus> {
    const account = await this.accountFor(hostId);
    return account ? this.toStatus(account) : NOT_CONNECTED;
  }

  /** Applied both by the status refresh and by the `account.updated` webhook. */
  async applyAccount(account: ProviderAccount): Promise<void> {
    await this.database.db
      .update(hostPaymentAccounts)
      .set({
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        detailsSubmitted: account.detailsSubmitted,
        onboardingStatus: toReadiness(account),
        updatedAt: new Date(),
      })
      .where(eq(hostPaymentAccounts.providerAccountId, account.providerAccountId));
  }

  private async accountFor(hostId: string): Promise<HostPaymentAccountRow | null> {
    const [row] = await this.database.db
      .select()
      .from(hostPaymentAccounts)
      .where(
        and(
          eq(hostPaymentAccounts.hostId, hostId),
          eq(hostPaymentAccounts.provider, this.provider.name),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** The provider account id stays server-side; a Host has no use for it. */
  private toStatus(row: HostPaymentAccountRow): HostPaymentStatus {
    return {
      provider: row.provider,
      readiness: row.onboardingStatus as HostPaymentReadiness,
      chargesEnabled: row.chargesEnabled,
      payoutsEnabled: row.payoutsEnabled,
      detailsSubmitted: row.detailsSubmitted,
      connected: true,
    };
  }
}
