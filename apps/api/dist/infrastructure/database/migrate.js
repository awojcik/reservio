"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const migrator_1 = require("drizzle-orm/postgres-js/migrator");
const node_path_1 = require("node:path");
const connection_1 = require("./connection");
const load_env_1 = require("../config/load-env");
(0, load_env_1.loadEnv)();
const migrationsFolder = (0, node_path_1.resolve)(__dirname, "../../../drizzle");
async function main() {
    const { db, client } = (0, connection_1.createDatabase)();
    try {
        await (0, migrator_1.migrate)(db, { migrationsFolder });
        console.log("Migracje zastosowane.");
    }
    finally {
        await client.end();
    }
}
main().catch((error) => {
    console.error("Migracja nie powiodła się:", error);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map