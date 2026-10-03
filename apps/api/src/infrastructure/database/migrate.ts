import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";

import { createDatabase } from "./connection";
import { loadEnv } from "../config/load-env";

loadEnv();

// CommonJS build (Nest), so __dirname is the reliable anchor here — the folder
// must resolve the same whether the script is run from the package or the root.
const migrationsFolder = resolve(__dirname, "../../../drizzle");

async function main() {
  const { db, client } = createDatabase();
  try {
    await migrate(db, { migrationsFolder });
    console.log("Migracje zastosowane.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migracja nie powiodła się:", error);
  process.exit(1);
});
