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
exports.IdempotencyService = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const schema_1 = require("../../infrastructure/database/schema");
const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(error) {
    const codes = [
        error.code,
        (error.cause ?? {}).code,
    ];
    return codes.includes(UNIQUE_VIOLATION);
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
let IdempotencyService = class IdempotencyService {
    database;
    config;
    constructor(database, config) {
        this.database = database;
        this.config = config;
    }
    get ttlSeconds() {
        return Number(this.config.get("BOOKING_IDEMPOTENCY_TTL_SECONDS") ?? 86_400);
    }
    async lookup(scope, key, payload) {
        const [existing] = await this.database.db
            .select()
            .from(schema_1.idempotencyKeys)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.idempotencyKeys.scope, scope), (0, drizzle_orm_1.eq)(schema_1.idempotencyKeys.keyHash, sha256(key))))
            .limit(1);
        if (!existing)
            return null;
        if (existing.expiresAt.getTime() <= Date.now()) {
            await this.database.db
                .delete(schema_1.idempotencyKeys)
                .where((0, drizzle_orm_1.eq)(schema_1.idempotencyKeys.id, existing.id));
            return null;
        }
        if (existing.requestHash !== sha256(JSON.stringify(payload))) {
            throw new common_1.ConflictException({
                code: "IDEMPOTENCY_KEY_REUSED",
                message: "Ten klucz idempotencji został już użyty z innymi danymi.",
            });
        }
        return { resourceId: existing.resourceId };
    }
    async remember(scope, key, payload, resource) {
        const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
        try {
            await this.database.db.insert(schema_1.idempotencyKeys).values({
                scope,
                keyHash: sha256(key),
                requestHash: sha256(JSON.stringify(payload)),
                resourceType: resource.type,
                resourceId: resource.id,
                expiresAt,
            });
            return { storedId: resource.id };
        }
        catch (error) {
            if (!isUniqueViolation(error))
                throw error;
            const winner = await this.lookup(scope, key, payload);
            return { storedId: winner?.resourceId ?? resource.id };
        }
    }
    async purgeExpired() {
        await this.database.db
            .delete(schema_1.idempotencyKeys)
            .where((0, drizzle_orm_1.lt)(schema_1.idempotencyKeys.expiresAt, new Date()));
    }
};
exports.IdempotencyService = IdempotencyService;
exports.IdempotencyService = IdempotencyService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object, config_1.ConfigService])
], IdempotencyService);
//# sourceMappingURL=idempotency.service.js.map