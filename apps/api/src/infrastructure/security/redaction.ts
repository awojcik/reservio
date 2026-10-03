/**
 * What must never reach a log file.
 *
 * The list is central because it is read twice — once by pino's own redaction
 * of request/response objects, once by the serialiser that scrubs URLs — and
 * two copies would drift apart exactly when it mattered (milestone 11 §25).
 */
export const REDACTED = "[redacted]";

/** Header and body paths pino removes before writing a line. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "req.headers['stripe-signature']",
  "res.headers['set-cookie']",
  // Bodies are not logged today, but a future `req.body` must not undo this.
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.accessCode",
  "req.body.wifiPassword",
  "req.body.clientSecret",
  "req.body.importUrl",
  "*.password",
  "*.accessCode",
  "*.wifiPassword",
  "*.clientSecret",
  "*.webhookSecret",
  "*.stripeSecretKey",
] as const;

/** Keys whose value is a secret, whatever object they turn up in. */
const SENSITIVE_KEY = /^(password|passwordhash|currentpassword|newpassword|token|accesstoken|accesscode|access_code|wifipassword|wifi_password|clientsecret|client_secret|websecret|webhooksecret|webhook_secret|authorization|cookie|setcookie|set_cookie|stripesecretkey|secret|apikey|api_key|cardnumber|card_number|cvc)$/i;

/**
 * Values that look like a credential whatever they are called: Stripe keys and
 * client secrets are recognisable on sight, and one accidentally interpolated
 * into a message is exactly the case a key-name filter misses.
 */
const SENSITIVE_VALUE = /\b((sk|rk|pk|whsec)_[A-Za-z0-9_]{6,}|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+)/g;

export function redactText(value: string): string {
  return value.replace(SENSITIVE_VALUE, REDACTED);
}

/**
 * Deep-scrubs a value destined for a log line or an audit row.
 *
 * Bounded in depth so a cyclic or absurdly nested object cannot turn logging
 * into a stack overflow.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, depth + 1);
  }
  return output;
}

/**
 * Strips credentials that travel inside a URL: the iCal export token sits in
 * the path, and a search term is somebody's name or email address.
 */
export function redactUrl(url: string): string {
  return redactText(
    url
      .replace(/\/calendar\/ical\/[^/?]+/, `/calendar/ical/${REDACTED}.ics`)
      .replace(/([?&](search|q|token|email)=)[^&]*/g, `$1${REDACTED}`),
  );
}
