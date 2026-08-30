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
