import type { FastifyHelmetOptions } from "@fastify/helmet";



/**
 * Response headers for the API.
 *
 * The API serves JSON and one HTML page — Swagger UI at `/api/docs`. That page
 * is the only reason a Content-Security-Policy here is not simply
 * `default-src 'none'`: Swagger builds its own DOM with inline styles.
 *
 * The policy that matters for Stripe Elements is the **web app's**, in
 * `next.config.ts`: Elements renders in an iframe served by Stripe, so the
 * page embedding it needs `frame-src` and `script-src` for Stripe's origins.
 * Nothing here can break it, because nothing here serves that page
 * (milestone 11 §23).
 */
export function securityHeadersFor(environment: {
  productionLike: boolean;
}): FastifyHelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Swagger UI ships its assets inline; the API's own responses are JSON.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // The API is never framed. Supersedes X-Frame-Options where supported.
        frameAncestors: ["'none'"],
        /*
         * Only meaningful behind TLS. Helmet adds it to its defaults, so on a
         * plain-HTTP dev server it has to be switched off explicitly — left
         * on, the browser rewrites every localhost request to https and the
         * web app cannot reach the API at all.
         */
        upgradeInsecureRequests: environment.productionLike ? [] : null,
      },
    },
    // Only where HTTPS is genuinely terminated. Sending HSTS from a plain-HTTP
    // dev server teaches the browser to refuse localhost over HTTP for months.
    hsts: environment.productionLike
      ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
    noSniff: true,
    // Nothing in the API needs a camera, a microphone or a location.
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
    crossOriginResourcePolicy: { policy: "same-site" },
    // The web app is a separate origin and must be able to read the responses;
    // COEP would additionally require every embedded resource to opt in.
    crossOriginEmbedderPolicy: false,
  };
}
