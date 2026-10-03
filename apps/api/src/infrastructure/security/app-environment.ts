/**
 * Which environment this process is, and what that implies.
 *
 * Four names rather than the usual two, because the interesting differences
 * are not "development or not": a staging deployment wants production cookie
 * and CORS rules while still running the Stripe sandbox, and the test suite
 * wants production-like behaviour to be assertable without setting
 * NODE_ENV=production (milestone 11 §26).
 */
export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironmentName = (typeof APP_ENVIRONMENTS)[number];

export type EnvSource = Record<string, string | undefined>;

/**
 * `APP_ENV` wins when set, otherwise NODE_ENV decides. Anything unrecognised
 * is development: an unfamiliar value must never quietly grant the production
 * relaxations, and the strict rules would break a laptop.
 */
export function environmentNameOf(env: EnvSource): AppEnvironmentName {
  const raw = (env.APP_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();

  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "stage") return "staging";
  if (raw === "test") return "test";
  return "development";
}

/** Production and staging share every hardening rule; only the data differs. */
export function isProductionLike(name: AppEnvironmentName): boolean {
  return name === "production" || name === "staging";
}
