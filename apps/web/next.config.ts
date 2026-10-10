import type { NextConfig } from "next";

const DEFAULT_STORAGE_BASE_URL = "http://localhost:9000/rezervio-local";

/**
 * Photos a Host uploads are served straight from the object storage, so the
 * allow-list is derived from S3_PUBLIC_BASE_URL rather than hard-coded: moving
 * from local MinIO to DigitalOcean Spaces is then an environment change, not a
 * code change.
 */
function storageRemotePatterns(): NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
> {
  const base = process.env.S3_PUBLIC_BASE_URL ?? DEFAULT_STORAGE_BASE_URL;

  try {
    const url = new URL(base);
    return [
      {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        pathname: "/**",
      },
    ];
  } catch {
    // A malformed value should not take the whole build down; the images
    // simply will not be allow-listed, which is visible immediately.
    return [];
  }
}

/**
 * The web app's Content-Security-Policy.
 *
 * This is the policy that matters for payments: Stripe Elements renders in an
 * iframe served by Stripe, so the page embedding it needs Stripe's script
 * origin, its frame origins and its API origin. A policy that forgets any of
 * the three produces a card field that silently never appears — which is why
 * they are listed explicitly and covered by a test (milestone 11 §23).
 *
 * `'unsafe-inline'` on styles is Next.js and Tailwind injecting a style tag;
 * `'unsafe-eval'` is only ever granted in development, where React Refresh
 * needs it.
 */
function contentSecurityPolicy(): string {
  const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api");
  const storageOrigin = originOf(process.env.S3_PUBLIC_BASE_URL ?? DEFAULT_STORAGE_BASE_URL);
  const development = process.env.NODE_ENV === "development";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    // Rezervio is never framed by anybody.
    "frame-ancestors": ["'none'"],
    "script-src": [
      "'self'",
      "https://js.stripe.com",
      // Next.js ships inline bootstrap scripts; the dev server also evals.
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://images.unsplash.com",
      storageOrigin,
      // The basemap's sprite sheet and its shaded-relief tiles at low zoom.
      "https://tiles.openfreemap.org",
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      apiOrigin,
      /*
       * The storage origin belongs here as well as in `img-src`, and for a
       * different reason: a Host uploads a photo with an XHR straight to the
       * presigned URL, and an XHR is governed by `connect-src`. Listed only
       * under `img-src`, the browser blocks the upload before it leaves the
       * page — and the only trace is a console line, because nothing ever
       * reaches the network tab.
       *
       * Development hid this for a long time: `http://localhost:*` below
       * covers local MinIO, so the gap only appears once storage lives
       * somewhere else (milestone 13).
       */
      storageOrigin,
      "https://api.stripe.com",
      "https://maps.stripe.com",
      // Map tiles and glyphs.
      "https://tiles.openfreemap.org",
      ...(development ? ["ws:", "http://localhost:*"] : []),
    ],
    // Stripe Elements and 3-D Secure both render inside Stripe-served frames.
    "frame-src": ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
    // MapLibre runs its renderer in a blob worker.
    "worker-src": ["'self'", "blob:"],
  };

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${[...new Set(values)].join(" ")}`)
    .join("; ");
}

/** The scheme+host of a URL, or nothing when it cannot be parsed. */
function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

/**
 * Headers every page carries.
 *
 * HSTS is deliberately absent in development: sent over plain HTTP it teaches
 * the browser to refuse localhost over HTTP for months, which breaks every
 * developer machine that ever loaded the page (milestone 11 §23).
 */
function securityHeaders() {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()",
    },
  ];

  if (process.env.NODE_ENV === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=15552000; includeSubDomains",
    });
  }

  return headers;
}

const nextConfig: NextConfig = {
  headers: async () => [{ source: "/:path*", headers: securityHeaders() }],

  /**
   * Ships a self-contained server in .next/standalone (~40 MB) instead of
   * needing node_modules (~630 MB) on the host — see DEPLOY.md.
   * Run it with `node .next/standalone/server.js`; `next start` ignores it.
   */
  output: "standalone",
  // The workspace client ships TypeScript source rather than a build step.
  transpilePackages: ["@rezervio/api-client"],

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      ...storageRemotePatterns(),
    ],

    /**
     * Next 16 refuses to optimise an upstream image whose hostname resolves to
     * a private IP — an SSRF precaution, and `remotePatterns` alone does not
     * satisfy it. Local MinIO is exactly such a host, so the escape hatch is
     * opened for development only. In production S3_PUBLIC_BASE_URL points at
     * a public host and this stays off.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
  },
};

export default nextConfig;
