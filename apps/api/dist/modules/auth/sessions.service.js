"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionsService = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const TOKEN_BYTES = 32;
const DEFAULT_TTL_SECONDS = 604_800;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
function hashToken(token) {
    return (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
}
let SessionsService = class SessionsService {
    database;
    cookieName;
    ttlSeconds;
    constructor(database, config) {
        this.database = database;
        this.cookieName = config.get("SESSION_COOKIE_NAME") ?? "rezervio_session";
        this.ttlSeconds = Number(config.get("SESSION_TTL_SECONDS") ?? DEFAULT_TTL_SECONDS);
    }
    async create(userId, executor = this.database.db) {
        const token = (0, node_crypto_1.randomBytes)(TOKEN_BYTES).toString("base64url");
        const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
        await executor
            .insert(schema_1.userSessions)
            .values({ userId, tokenHash: hashToken(token), expiresAt });
        return token;
    }
    async resolve(token) {
        const now = new Date();
        const [row] = await this.database.db
            .select({
            sessionId: schema_1.userSessions.id,
            lastSeenAt: schema_1.userSessions.lastSeenAt,
            userId: schema_1.users.id,
            email: schema_1.users.email,
        })
            .from(schema_1.userSessions)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.userSessions.userId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userSessions.tokenHash, hashToken(token)), (0, drizzle_orm_1.gt)(schema_1.userSessions.expiresAt, now)))
            .limit(1);
        if (!row)
            return null;
        const stale = row.lastSeenAt === null ||
            now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS;
        if (stale) {
            await this.database.db
                .update(schema_1.userSessions)
                .set({ lastSeenAt: now })
                .where((0, drizzle_orm_1.eq)(schema_1.userSessions.id, row.sessionId));
        }
        return { id: row.userId, email: row.email };
    }
    async revoke(token) {
        await this.database.db
            .delete(schema_1.userSessions)
            .where((0, drizzle_orm_1.eq)(schema_1.userSessions.tokenHash, hashToken(token)));
    }
    async purgeExpired() {
        await this.database.db
            .delete(schema_1.userSessions)
            .where((0, drizzle_orm_1.lt)(schema_1.userSessions.expiresAt, new Date()));
    }
};
exports.SessionsService = SessionsService;
exports.SessionsService = SessionsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object, config_1.ConfigService])
], SessionsService);
//# sourceMappingURL=sessions.service.js.map