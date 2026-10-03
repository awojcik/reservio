import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

type Db = Database["db"];
/**
 * Whatever a query can run against. Services take this rather than the pool so
 * the same method works standalone and inside `db.transaction(...)` — register
 * and image reorder need several writes to succeed or fail together.
 */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (see README).",
    );
  }
  return url;
}

/**
 * One pool per process. `max` is deliberately small: the API is stateless and
 * meant to scale out, so each instance should hold few connections.
 */
export function createDatabase(url = resolveDatabaseUrl()) {
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
