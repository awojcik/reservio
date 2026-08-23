import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Ships a self-contained server in .next/standalone (~40 MB) instead of
   * needing node_modules (~630 MB) on the host — see DEPLOY.md.
   * Run it with `node .next/standalone/server.js`; `next start` ignores it.
   */
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
