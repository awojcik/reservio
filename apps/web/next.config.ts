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

const nextConfig: NextConfig = {
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
