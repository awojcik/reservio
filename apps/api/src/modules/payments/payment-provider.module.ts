import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";

import { PAYMENT_PROVIDER } from "./domain/payment-provider";
import { HostPaymentsService } from "./host-payments.service";
import {
  STRIPE_CLIENT,
  StripePaymentProvider,
} from "./infrastructure/stripe-payment-provider";

/**
 * The provider itself, separated from what uses it.
 *
 * Payments and Settlements both talk to the same PSP, but Settlements must not
 * depend on the Payments module — Payments is the side that reacts to a
 * settlement being needed. One small module for the adapter keeps that
 * direction honest instead of forcing a `forwardRef`.
 */
@Module({
  providers: [
    {
      provide: STRIPE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Stripe =>
        /*
         * A checked-out repository has no keys, and the application must still
         * boot: everything except paying works without them. An unset key
         * becomes an obviously-invalid placeholder, so the first Stripe call
         * fails with a clear provider error instead of the whole container
         * refusing to start (milestone 08 §55).
         */
        new Stripe(config.get<string>("STRIPE_SECRET_KEY")?.trim() || "sk_test_unset", {
          // Pinned: an account-level API upgrade must not change behaviour
          // under a running deployment.
          apiVersion: "2026-08-26.dahlia",
          typescript: true,
          maxNetworkRetries: 2,
        }),
    },
    { provide: PAYMENT_PROVIDER, useClass: StripePaymentProvider },
    StripePaymentProvider,
    HostPaymentsService,
  ],
  exports: [PAYMENT_PROVIDER, StripePaymentProvider, HostPaymentsService],
})
export class PaymentProviderModule {}
