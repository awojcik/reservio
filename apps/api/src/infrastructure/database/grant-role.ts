import { sql } from "drizzle-orm";

import { createDatabase } from "./connection";
import { loadEnv } from "../config/load-env";
import { USER_ROLES, type UserRole } from "./schema";

loadEnv();

/**
 * Grants a staff role to an existing account.
 *
 * A script rather than an endpoint, deliberately: an API that can promote an
 * account to ADMIN is an API worth attacking, and the first admin has to come
 * from somewhere outside the application anyway. Access to the database is
 * already access to everything (milestone 11 §3).
 *
 *   pnpm --filter @rezervio/api admin:grant ada@example.com ADMIN
 *   pnpm --filter @rezervio/api admin:grant ada@example.com --revoke
 */
async function main(): Promise<void> {
  const [emailArg, roleArg] = process.argv.slice(2);

  if (!emailArg) {
    console.error("Użycie: admin:grant <email> [SUPPORT|ADMIN|--revoke]");
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const revoke = roleArg === "--revoke";
  const role = (revoke ? null : ((roleArg ?? "ADMIN").toUpperCase() as UserRole));

  if (role && !USER_ROLES.includes(role)) {
    console.error(`Nieznana rola "${roleArg}". Dozwolone: ${USER_ROLES.join(", ")}.`);
    process.exit(1);
  }

  const { db, client } = createDatabase();

  try {
    // `array_append` guarded by a membership test, so running this twice is a
    // no-op rather than a row with ADMIN listed twice.
    const rows = revoke
      ? await db.execute(sql`
          UPDATE users
          SET roles = '{}'::text[], updated_at = now()
          WHERE email = ${email}
          RETURNING email, roles
        `)
      : await db.execute(sql`
          UPDATE users
          SET roles = CASE
                WHEN ${role} = ANY(roles) THEN roles
                ELSE array_append(roles, ${role})
              END,
              updated_at = now()
          WHERE email = ${email}
          RETURNING email, roles
        `);

    const updated = rows as unknown as { email: string; roles: string[] }[];

    if (updated.length === 0) {
      console.error(`Nie ma konta ${email}. Załóż je najpierw przez /register.`);
      process.exit(1);
    }

    console.log(
      `${updated[0].email} → role: ${updated[0].roles.length ? updated[0].roles.join(", ") : "(brak)"}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Nie udało się zmienić roli:", error);
  process.exit(1);
});
