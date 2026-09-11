import { redactValue } from "../../../infrastructure/security/redaction";
import { ProviderError } from "../domain/provider-errors";

/**
 * The only way this module reaches the network.
 *
 * Every base URL is compared against an allowlist before the request is made.
 * Provider configuration is Host-influenced data, and a base URL taken from it
 * without checking would be a server-side request forgery with our own
 * credentials attached — the iCal importer has the same guard for the same
 * reason (milestone 12 §38).
 */
export type AllowedHosts = readonly string[];

export class ProviderUrlRejected extends ProviderError {
  constructor(url: string) {
    super(`Adres ${url} nie należy do dozwolonych domen dostawcy.`, "URL_NOT_ALLOWED", false);
  }
}

/** Loopback literals. The only place plain HTTP is ever tolerated. */
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** Exact host match, or an exact suffix after a dot. Never a substring. */
export function isAllowedProviderUrl(rawUrl: string, allowed: AllowedHosts): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  /*
   * Plain HTTP would put a bearer token on the wire in clear text.
   *
   * The one exception is a loopback address outside production, which is how a
   * contract test can point the real adapter at a local double and assert on
   * what it actually sends. It is ignored outright when NODE_ENV is
   * "production", so setting it on a deployed instance cannot open the hole —
   * the same shape as the iCal importer's development escape hatch.
   */
  if (parsed.protocol !== "https:") {
    const loopbackOk =
      parsed.protocol === "http:" &&
      LOOPBACK.has(parsed.hostname) &&
      process.env.NODE_ENV !== "production";

    if (!loopbackOk) return false;
  }

  return allowed.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}

export type ProviderRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  /** JSON body, or form-encoded when `form` is set. */
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
};

export type ProviderResponse = {
  status: number;
  body: unknown;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Codes a caller may sensibly retry.
 *
 * 429 and 5xx are the provider asking for patience. 401 and 403 are the
 * provider saying no, and no amount of repetition changes that
 * (milestone 12 §27).
 */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Performs one provider call.
 *
 * Never logs headers or bodies: the Authorization header carries a bearer
 * token, and provider payloads carry Guest names. What a failure is allowed to
 * carry into an error message is the status and the provider's own error code
 * (milestone 12 §38).
 */
export async function providerFetch(
  request: ProviderRequest,
  allowed: AllowedHosts,
): Promise<ProviderResponse> {
  if (!isAllowedProviderUrl(request.url, allowed)) {
    throw new ProviderUrlRejected(request.url);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(request.form
          ? { "content-type": "application/x-www-form-urlencoded" }
          : request.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        ...request.headers,
      },
      body: request.form
        ? new URLSearchParams(request.form).toString()
        : request.body !== undefined
          ? JSON.stringify(request.body)
          : undefined,
    });
  } catch (error) {
    clearTimeout(timeout);

    const aborted = (error as Error).name === "AbortError";
    throw new ProviderError(
      aborted ? "Dostawca nie odpowiedział na czas." : "Nie udało się połączyć z dostawcą.",
      aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new ProviderError(
      providerMessage(body) ?? `Dostawca odpowiedział ${response.status}.`,
      codeFor(response.status),
      retryableStatus(response.status),
      response.status,
    );
  }

  return { status: response.status, body };
}

function codeFor(status: number): string {
  if (status === 401 || status === 403) return "CREDENTIALS_REJECTED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED";
}

/**
 * The provider's own message, scrubbed.
 *
 * Useful for diagnosis and routinely careless about what it echoes — a
 * rejected request is often quoted back verbatim, credentials included.
 */
function providerMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const message = (body as { message?: unknown }).message;
  if (typeof message !== "string") return null;

  return String(redactValue(message)).slice(0, 200);
}
