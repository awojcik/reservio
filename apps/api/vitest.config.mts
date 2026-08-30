import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration and e2e tests talk to the local PostgreSQL; give them room.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  // NestJS relies on emitDecoratorMetadata, which esbuild does not produce.
  plugins: [swc.vite({ module: { type: "es6" } })],
});
