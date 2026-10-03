import { Global, Injectable, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  environmentNameOf,
  isProductionLike,
  type AppEnvironmentName,
} from "./app-environment";
import { parseOrigins, stripeKeyMode, type StripeKeyMode } from "./env-validation";
import { RateLimitGuard } from "./rate-limit.guard";
import { RateLimiterService } from "./rate-limiter.service";

/**
 * The answers the rest of the app needs about *where it is running*.
 *
 * Centralised so "are we in production?" and "is this key a test key?" have a
 * single definition. Both were previously re-derived from `process.env` at
 * three or four call sites, which is how a hardening rule ends up applied in
 * three places out of four.
 */
@Injectable()
export class AppEnvironmentService {
  readonly name: AppEnvironmentName;
  readonly productionLike: boolean;
  readonly allowedOrigins: string[];

  constructor(private readonly config: ConfigService) {
    this.name = environmentNameOf({
      APP_ENV: config.get<string>("APP_ENV"),
      NODE_ENV: config.get<string>("NODE_ENV"),
    });
    this.productionLike = isProductionLike(this.name);
    this.allowedOrigins = parseOrigins(config.get<string>("WEB_ORIGIN"), [
      "http://localhost:3000",
    ]);
  }

  /**
   * Which Stripe key this process holds. `UNSET` is a normal state: a checked
   * out repository has no keys and everything except paying still works.
   */
  get stripeMode(): StripeKeyMode {
    return stripeKeyMode(this.config.get<string>("STRIPE_SECRET_KEY"));
  }

  /**
   * True whenever Rezervio is talking to the Stripe sandbox — which, in this
   * milestone, is always. A live key never reaches here: startup validation
   * rejects it (milestone 11 §27, §28).
   */
  get stripeTestMode(): boolean {
    return this.stripeMode !== "LIVE";
  }
}

@Global()
@Module({
  providers: [AppEnvironmentService, RateLimiterService, RateLimitGuard],
  exports: [AppEnvironmentService, RateLimiterService, RateLimitGuard],
})
export class SecurityModule {}
