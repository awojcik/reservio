import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

/**
 * SSRF-safe fetch for Host-supplied iCal URLs.
 *
 * The Host controls this URL and the backend follows it, which makes this a
 * classic server-side request forgery surface: `http://169.254.169.254/…`
 * would read cloud credentials, `http://localhost:5432` would probe the
 * database. A hostname regex is not enough (milestone 03 §24) — a public name
 * can resolve to a private address, and a public URL can redirect to one.
 *
 * So every address is checked three times over:
 *   1. the scheme and literal host, before any network call;
 *   2. every address DNS returns, before connecting;
 *   3. the same checks again on each redirect hop.
 *
 * The DNS result is pinned into the socket via a custom `lookup`, so the name
 * cannot resolve to something else between validation and connection.
 */
export type SafeFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /**
   * Development-only escape hatch. Without it a mock feed on localhost is
   * unreachable, so nobody could exercise iCal import on their own machine.
   *
   * It is ignored outright when NODE_ENV is "production", so setting the
   * variable on a deployed instance cannot open the SSRF hole — the guard is
   * not a configuration decision there.
   */
  allowPrivateHosts?: boolean;
};

/** True only when the caller asked for it AND this is not production. */
export function privateHostsAllowed(allow: boolean | undefined): boolean {
  return allow === true && process.env.NODE_ENV !== "production";
}

export type SafeFetchResult = {
  body: string;
  finalUrl: string;
};

export class UnsafeUrlError extends Error {
  readonly code = "SECURITY_REJECTED";
}

export class FetchFailedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Local names. Blocked in normal operation, but reachable under the
 * development escape hatch — that is the only way to point the importer at a
 * mock feed on your own machine.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

/**
 * Cloud metadata services. Never a legitimate calendar feed, in any
 * environment, so the escape hatch does not reach these.
 */
const METADATA_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "metadata.goog",
]);

function ipv4ToInt(address: string): number {
  return address
    .split(".")
    .reduce((total, octet) => (total << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIPv4(address: string): boolean {
  const value = ipv4ToInt(address);
  const inRange = (cidr: string, bits: number) =>
    (value & (~0 << (32 - bits))) >>> 0 === (ipv4ToInt(cidr) & (~0 << (32 - bits))) >>> 0;

  return (
    inRange("0.0.0.0", 8) || // "this network"
    inRange("10.0.0.0", 8) || // private
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local, incl. cloud metadata
    inRange("172.16.0.0", 12) || // private
    inRange("192.0.0.0", 24) || // IETF protocol assignments
    inRange("192.168.0.0", 16) || // private
    inRange("100.64.0.0", 10) || // carrier-grade NAT
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved, incl. broadcast
  );
}

function isPrivateIPv6(address: string): boolean {
  const normalised = address.toLowerCase().split("%")[0];

  if (normalised === "::1" || normalised === "::") return true;
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalised)) return true;

  // IPv4-mapped (::ffff:10.0.0.1) would otherwise sneak past the v6 checks.
  const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true; // not an IP at all — refuse rather than guess
}

/** Scheme and literal-host checks that need no network call. */
export function assertAllowedUrl(rawUrl: string, allowPrivateHosts = false): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Adres kalendarza nie jest poprawnym URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(
      `Dozwolone są wyłącznie adresy http i https (otrzymano ${url.protocol}).`,
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Checked before the escape hatch: a metadata endpoint is never a feed.
  if (METADATA_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError("Adres wskazuje na endpoint metadanych chmury.");
  }

  if (privateHostsAllowed(allowPrivateHosts)) return url;

  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError("Adres wskazuje na hosta lokalnego.");
  }

  // A literal IP skips DNS entirely, so it has to be judged right here.
  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw new UnsafeUrlError("Adres wskazuje na sieć prywatną lub zastrzeżoną.");
  }

  return url;
}

/** Resolves the hostname and refuses if any answer is a private address. */
export async function resolveSafely(
  hostname: string,
  allowPrivateHosts = false,
): Promise<{ address: string; family: number }[]> {
  const cleaned = hostname.replace(/^\[|\]$/g, "");

  if (isIP(cleaned)) {
    if (!privateHostsAllowed(allowPrivateHosts) && isBlockedAddress(cleaned)) {
      throw new UnsafeUrlError("Adres wskazuje na sieć prywatną lub zastrzeżoną.");
    }
    return [{ address: cleaned, family: isIP(cleaned) }];
  }

  let answers: { address: string; family: number }[];
  try {
    answers = await dnsLookup(cleaned, { all: true });
  } catch {
    throw new FetchFailedError(`Nie udało się rozwiązać nazwy ${cleaned}.`, "DNS_ERROR");
  }

  if (answers.length === 0) {
    throw new FetchFailedError(`Nazwa ${cleaned} nie ma adresów.`, "DNS_ERROR");
  }

  if (privateHostsAllowed(allowPrivateHosts)) return answers;

  // Any private answer rejects the whole host: a name that resolves to both a
  // public and a private address is exactly the rebinding pattern to refuse.
  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) {
      throw new UnsafeUrlError(
        "Adres kalendarza rozwiązuje się do sieci prywatnej lub zastrzeżonej.",
      );
    }
  }

  return answers;
}

export async function safeFetchIcal(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const url = assertAllowedUrl(currentUrl, options.allowPrivateHosts);
    const addresses = await resolveSafely(url.hostname, options.allowPrivateHosts);

    const response = await requestOnce(url, addresses, options);

    if (response.redirectTo) {
      if (hop === options.maxRedirects) {
        throw new FetchFailedError("Przekroczono limit przekierowań.", "TOO_MANY_REDIRECTS");
      }
      // Re-validated from the top of the loop, so a public URL cannot bounce
      // into a private one.
      currentUrl = new URL(response.redirectTo, url).toString();
      continue;
    }

    return { body: response.body, finalUrl: url.toString() };
  }

  throw new FetchFailedError("Przekroczono limit przekierowań.", "TOO_MANY_REDIRECTS");
}

type SingleResponse = { body: string; redirectTo?: string };

function requestOnce(
  url: URL,
  addresses: { address: string; family: number }[],
  options: SafeFetchOptions,
): Promise<SingleResponse> {
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<SingleResponse>((resolve, reject) => {
    const request = transport(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
          "user-agent": "Rezervio/0.3 (+calendar-sync)",
        },
        timeout: options.timeoutMs,
        // Pins the already-validated address, closing the window between the
        // DNS check above and the actual connection.
        lookup: (_hostname, lookupOptions, callback) => {
          const chosen = addresses[0];
          if (typeof lookupOptions === "function") {
            (lookupOptions as (e: Error | null, a: string, f: number) => void)(
              null,
              chosen.address,
              chosen.family,
            );
            return;
          }
          if (lookupOptions?.all) {
            (callback as unknown as (e: Error | null, a: typeof addresses) => void)(
              null,
              addresses,
            );
            return;
          }
          callback(null, chosen.address, chosen.family);
        },
      },
      (message: IncomingMessage) => {
        const status = message.statusCode ?? 0;

        if (status >= 300 && status < 400 && message.headers.location) {
          message.resume();
          resolve({ body: "", redirectTo: message.headers.location });
          return;
        }

        if (status < 200 || status >= 300) {
          message.resume();
          reject(new FetchFailedError(`Serwer odpowiedział ${status}.`, "HTTP_ERROR"));
          return;
        }

        let received = 0;
        const chunks: Buffer[] = [];

        message.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) {
            message.destroy();
            reject(
              new FetchFailedError(
                `Odpowiedź przekracza ${options.maxBytes} bajtów.`,
                "RESPONSE_TOO_LARGE",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });

        message.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8") }));
        message.on("error", (error) =>
          reject(new FetchFailedError(error.message, "NETWORK_ERROR")),
        );
      },
    );

    request.on("timeout", () => {
      request.destroy();
      reject(new FetchFailedError("Przekroczono czas oczekiwania.", "TIMEOUT"));
    });
    request.on("error", (error) =>
      reject(new FetchFailedError(error.message, "NETWORK_ERROR")),
    );
    request.end();
  });
}
