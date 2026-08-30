import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://rezervio:rezervio@localhost:5432/rezervio",
  },
  // The geography column, spatial/FTS/trigram indexes and extensions live in
  // hand-written migrations — Drizzle should not try to drop what it cannot model.
  extensionsFilters: ["postgis"],
  verbose: true,
});
