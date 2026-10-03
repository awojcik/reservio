import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  REQUEST_ID_HEADER,
  enterRequestContext,
  normaliseRequestId,
} from "./request-context";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Gives every request a correlation id and hands it back on the response.
 *
 * An id supplied by the caller is reused, so a trace started in Next.js
 * continues into the API instead of splitting into two unrelated halves
 * (milestone 11 §13).
 */
export function installRequestContext(instance: FastifyInstance): void {
  instance.addHook("onRequest", (request, reply, done) => {
    const requestId = normaliseRequestId(request.headers[REQUEST_ID_HEADER]);

    reply.header(REQUEST_ID_HEADER, requestId);
    // `enterWith`, not `run`: the rest of this request is handled by later
    // hooks and the route handler, all outside this callback's own frame.
    enterRequestContext({ requestId });
    done();
  });
}

export type OriginProtectionOptions = {
  allowedOrigins: string[];
  /** Cookies Rezervio itself mints. Only these make a request forgeable. */
  cookieNames: string[];
};

function originOf(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin !== "null") return origin.replace(/\/$/, "");

  // Some browsers omit Origin on same-site form posts but still send Referer.
  const referer = request.headers.referer;
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  return null;
}

function carriesOurCookie(request: FastifyRequest, names: string[]): boolean {
  const header = request.headers.cookie;
  if (typeof header !== "string") return false;
  return names.some((name) => header.includes(`${name}=`));
}

/**
 * Origin checking for cookie-authenticated, state-changing requests.
 *
 * Rezervio's cookies are `SameSite=Lax`, which already withholds them from
 * every cross-site POST — this is the second layer, for the browser that gets
 * that wrong and for the day a flow needs `SameSite=None`.
 *
 * Two deliberate limits:
 *
 * - only requests that actually carry a Rezervio cookie are checked. The
 *   Stripe webhook is authenticated by a signature over the raw body and
 *   arrives with no cookie and no Origin; rejecting it here would lose
 *   payment events, which is the one failure this system must not have
 *   (milestone 11 §20).
 * - a *missing* Origin is allowed, a *mismatched* one is not. CSRF is by
 *   definition mounted from a page in a browser, and a browser always sends
 *   Origin on a cross-site state-changing request. Demanding the header would
 *   only break non-browser clients, which were never the threat.
 */
export function installOriginProtection(
  instance: FastifyInstance,
  options: OriginProtectionOptions,
): void {
  const allowed = new Set(options.allowedOrigins.map((origin) => origin.replace(/\/$/, "")));

  instance.addHook("onRequest", (request, reply: FastifyReply, done) => {
    if (!STATE_CHANGING.has(request.method)) return done();
    if (!carriesOurCookie(request, options.cookieNames)) return done();

    const fetchSite = request.headers["sec-fetch-site"];
    const origin = originOf(request);

    const crossSite =
      fetchSite === "cross-site" || (origin !== null && !allowed.has(origin));

    if (!crossSite) return done();

    reply.status(403).send({
      code: "INVALID_ORIGIN",
      message: "Żądanie pochodzi z niedozwolonego źródła.",
    });
    return undefined;
  });
}

/**
 * Headers helmet does not set.
 *
 * `Permissions-Policy` denies the browser features an API has no business
 * asking for. Sent as a deny-list of the sensitive ones rather than `*=()`,
 * which some browsers reject outright (milestone 11 §23).
 */
export function installExtraSecurityHeaders(instance: FastifyInstance): void {
  const policy = [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
    "usb=()",
    "interest-cohort=()",
  ].join(", ");

  instance.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("permissions-policy", policy);
    done(null, payload);
  });
}
