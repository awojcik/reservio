"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function loadEnv() {
    const candidates = [
        (0, node_path_1.resolve)(process.cwd(), ".env"),
        (0, node_path_1.resolve)(process.cwd(), "../../.env"),
    ];
    for (const path of candidates) {
        if ((0, node_fs_1.existsSync)(path)) {
            process.loadEnvFile(path);
            break;
        }
    }
    process.env.DATABASE_URL ??=
        "postgresql://rezervio:rezervio@localhost:5432/rezervio";
}
//# sourceMappingURL=load-env.js.map