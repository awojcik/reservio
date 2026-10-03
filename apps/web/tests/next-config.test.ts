import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The image allow-list is derived from S3_PUBLIC_BASE_URL, and getting it wrong
 * fails silently — photos simply stop rendering. This guards both halves:
 * the derived host, and the SSRF escape hatch staying off outside development.
 */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import("../next.config")).default;
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("images.remotePatterns", () => {
  it("allow-lists the local MinIO host, port included", async () => {
    const config = await loadConfig({
      S3_PUBLIC_BASE_URL: "http://localhost:9000/rezervio-local",
      NODE_ENV: "development",
    });

    expect(config.images?.remotePatterns).toContainEqual({
      protocol: "http",
      hostname: "localhost",
      port: "9000",
      pathname: "/**",
    });
  });

  it("allow-lists a DigitalOcean Spaces host without inventing a port", async () => {
    const config = await loadConfig({
      S3_PUBLIC_BASE_URL: "https://rezervio.fra1.digitaloceanspaces.com",
      NODE_ENV: "production",
    });

    expect(config.images?.remotePatterns).toContainEqual({
      protocol: "https",
      hostname: "rezervio.fra1.digitaloceanspaces.com",
      pathname: "/**",
    });
  });

  it("keeps the seeded Unsplash catalogue working", async () => {
    const config = await loadConfig({ S3_PUBLIC_BASE_URL: undefined });

    expect(config.images?.remotePatterns).toContainEqual(
      expect.objectContaining({ hostname: "images.unsplash.com" }),
    );
  });

  it("does not take the build down on a malformed URL", async () => {
    const config = await loadConfig({ S3_PUBLIC_BASE_URL: "to-nie-jest-url" });

    // Unsplash survives; the storage pattern is simply absent.
    expect(config.images?.remotePatterns).toHaveLength(1);
  });

  it("opens the private-IP escape hatch only in development", async () => {
    const development = await loadConfig({ NODE_ENV: "development" });
    const production = await loadConfig({ NODE_ENV: "production" });

    expect(development.images?.dangerouslyAllowLocalIP).toBe(true);
    expect(production.images?.dangerouslyAllowLocalIP).toBe(false);
  });
});

/**
 * The Content-Security-Policy is the one header that can silently break
 * payments: Stripe Elements renders in a Stripe-served iframe, so a policy
 * missing `frame-src` produces a card field that never appears and no error
 * anybody sees (milestone 11 §23, §44).
 */
async function policyFor(env: Record<string, string | undefined>): Promise<string> {
  const config = await loadConfig(env);
  const headers = await config.headers!();
  const csp = headers[0].headers.find((header) => header.key === "Content-Security-Policy");
  return csp!.value;
}

async function headerKeys(env: Record<string, string | undefined>): Promise<string[]> {
  const config = await loadConfig(env);
  return (await config.headers!())[0].headers.map((header) => header.key);
}

describe("security headers", () => {
  it("lets Stripe Elements load, frame and call home", async () => {
    const policy = await policyFor({ NODE_ENV: "production" });

    expect(policy).toContain("script-src");
    expect(policy).toMatch(/script-src[^;]*https:\/\/js\.stripe\.com/);
    expect(policy).toMatch(/frame-src[^;]*https:\/\/js\.stripe\.com/);
    expect(policy).toMatch(/frame-src[^;]*https:\/\/hooks\.stripe\.com/);
    expect(policy).toMatch(/connect-src[^;]*https:\/\/api\.stripe\.com/);
  });

  it("allows the browser to reach the API it was configured with", async () => {
    const policy = await policyFor({
      NODE_ENV: "production",
      NEXT_PUBLIC_API_URL: "https://api.rezervio.pl/api",
    });

    expect(policy).toMatch(/connect-src[^;]*https:\/\/api\.rezervio\.pl/);
  });

  it("refuses to be framed and forbids inline objects", async () => {
    const policy = await policyFor({ NODE_ENV: "production" });

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it("grants unsafe-eval only in development", async () => {
    expect(await policyFor({ NODE_ENV: "development" })).toContain("'unsafe-eval'");
    expect(await policyFor({ NODE_ENV: "production" })).not.toContain("'unsafe-eval'");
  });

  it("keeps the map renderer's blob worker working", async () => {
    const policy = await policyFor({ NODE_ENV: "production" });

    expect(policy).toMatch(/worker-src[^;]*blob:/);
    expect(policy).toMatch(/connect-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  });

  /**
   * Vector tiles and glyphs are fetched, but the basemap also carries a sprite
   * sheet and shaded-relief raster tiles — those are images. Leaving them out
   * costs no error anybody sees, just a map missing its icons and its terrain.
   */
  it("lets the basemap load its sprites and raster tiles", async () => {
    const policy = await policyFor({ NODE_ENV: "production" });

    expect(policy).toMatch(/img-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  });

  it("sends HSTS only in production", async () => {
    // Read back one environment at a time: `headers()` resolves the
    // environment when Next calls it, not when the module is imported.
    expect(await headerKeys({ NODE_ENV: "production" })).toContain(
      "Strict-Transport-Security",
    );
    // Over plain HTTP it would teach the browser to refuse localhost for months.
    expect(await headerKeys({ NODE_ENV: "development" })).not.toContain(
      "Strict-Transport-Security",
    );
  });

  it("sends the rest of the hardening headers everywhere", async () => {
    expect(await headerKeys({ NODE_ENV: "development" })).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
        "Permissions-Policy",
      ]),
    );
  });
});
