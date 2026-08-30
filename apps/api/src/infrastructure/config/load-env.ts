import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads .env for the standalone scripts (migrate, seed) that run outside the
 * Nest lifecycle. Inside the app @nestjs/config does this. Repo root is checked
 * too, so one .env can serve the whole monorepo.
 */
export function loadEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      break;
    }
  }

  process.env.DATABASE_URL ??=
    "postgresql://rezervio:rezervio@localhost:5432/rezervio";
}
