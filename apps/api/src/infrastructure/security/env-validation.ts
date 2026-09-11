import {
  environmentNameOf,
  isProductionLike,
  type AppEnvironmentName,
  type EnvSource,
} from "./app-environment";

/**
 * Configuration is checked once, at startup, and the process refuses to serve
 * traffic on a bad answer.
 *
 * A missing secret discovered by the first request that needs it is a runtime
 * incident; the same secret discovered at boot is a failed deploy. The two
 * cost very different amounts (milestone 11 §26).
 */
export class EnvironmentValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Nieprawidłowa konfiguracja środowiska:\n- ${problems.join("\n- ")}`);
    this.name = "EnvironmentValidationError";
  }
}

export type ValidatedEnvironment = {
  name: AppEnvironmentName;
  productionLike: boolean;
  /** Origins allowed to call the API with credentials. Never `*`. */
  allowedOrigins: string[];
  stripe: StripeKeyMode;
  warnings: string[];
};

export type StripeKeyMode = "TEST" | "LIVE" | "UNSET";

/**
 * What kind of key this is, by its own prefix.
 *
 * Stripe restricted keys start `rk_`, so both families are inspected; anything
 * else is treated as unset rather than guessed at.
 */
export function stripeKeyMode(rawKey: string | undefined): StripeKeyMode {
  const key = (rawKey ?? "").trim();
  if (key === "" || key === "sk_test_unset") return "UNSET";
  if (/^(sk|rk)_live_/.test(key)) return "LIVE";
  if (/^(sk|rk)_test_/.test(key)) return "TEST";
  return "UNSET";
}

/** Explicit allowlist, split and trimmed. A wildcard is never produced here. */
export function parseOrigins(raw: string | undefined, fallback: string[]): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => origin.length > 0 && origin !== "*");

  return parsed.length > 0 ? parsed : fallback;
}

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "REDIS_URL",
  "WEB_ORIGIN",
  "APP_BASE_URL",
  "ICAL_URL_ENCRYPTION_KEY",
] as const;

/**
 * Validates the environment and returns what the rest of the app should read
 * instead of poking at `process.env` again.
 */
export function validateEnvironment(env: EnvSource): ValidatedEnvironment {
  const name = environmentNameOf(env);
  const productionLike = isProductionLike(name);
  const problems: string[] = [];
  const warnings: string[] = [];

  const stripe = stripeKeyMode(env.STRIPE_SECRET_KEY);

  /*
   * The one rule this milestone will not bend: outside production a live key
   * is a mistake, and a mistake that charges real cards. Failing the boot is
   * the only response that cannot be missed (milestone 11 §28).
   */
  if (stripe === "LIVE" && !productionLike) {
    problems.push(
      `STRIPE_SECRET_KEY wygląda na klucz live, a środowisko to "${name}". Rezervio działa wyłącznie w trybie sandbox — użyj klucza sk_test_….`,
    );
  }

  /*
   * Production is not exempt either. Going live is a separate, deliberate
   * decision that this milestone does not make; until it is made, a live key
   * in any environment stops the process (milestone 11 §1, §30).
   */
  if (stripe === "LIVE" && productionLike) {
    problems.push(
      "STRIPE_SECRET_KEY wygląda na klucz live. Rezervio jest w trybie sandbox — przejście na live wymaga osobnej decyzji, nie zmiany zmiennej środowiskowej.",
    );
  }

  if (productionLike) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!(env[key] ?? "").trim()) {
        problems.push(`Brak wymaganej zmiennej ${key}.`);
      }
    }

    const origins = parseOrigins(env.WEB_ORIGIN, []);
    if (origins.length === 0) {
      problems.push("WEB_ORIGIN musi zawierać jawną listę dozwolonych origin — bez '*'.");
    }
    for (const origin of origins) {
      if (!/^https:\/\//.test(origin)) {
        problems.push(`WEB_ORIGIN "${origin}" nie używa https.`);
      }
    }

    if (stripe === "UNSET") {
      warnings.push("STRIPE_SECRET_KEY nie jest ustawiony — płatności będą zwracać błąd dostawcy.");
    }
    if (!(env.STRIPE_WEBHOOK_SECRET ?? "").trim()) {
      warnings.push(
        "STRIPE_WEBHOOK_SECRET nie jest ustawiony — webhooki zostaną odrzucone, a rezerwacje nie będą potwierdzane.",
      );
    }
  }

  if (problems.length > 0) throw new EnvironmentValidationError(problems);

  return {
    name,
    productionLike,
    allowedOrigins: parseOrigins(env.WEB_ORIGIN, ["http://localhost:3000"]),
    stripe,
    warnings,
  };
}
