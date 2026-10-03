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
var HealthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../infrastructure/database/database.module");
const queue_module_1 = require("../../infrastructure/queue/queue.module");
const security_module_1 = require("../../infrastructure/security/security.module");
const health_dto_1 = require("./dto/health.dto");
const PROBE_TIMEOUT_MS = 2_000;
async function probe(name, check, logger) {
    const started = Date.now();
    try {
        await Promise.race([
            check(),
            new Promise((_resolve, reject) => setTimeout(() => reject(new Error("TIMEOUT")), PROBE_TIMEOUT_MS).unref()),
        ]);
        return { status: "up", latencyMs: Date.now() - started, error: null };
    }
    catch (error) {
        logger.error({ event: "health.dependency_down", dependency: name, error });
        const raw = error.code;
        const code = typeof raw === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(raw) ? raw : "UNAVAILABLE";
        return { status: "down", latencyMs: null, error: code };
    }
}
let HealthController = HealthController_1 = class HealthController {
    database;
    redis;
    environment;
    logger = new common_1.Logger(HealthController_1.name);
    constructor(database, redis, environment) {
        this.database = database;
        this.redis = redis;
        this.environment = environment;
    }
    check() {
        return {
            status: "ok",
            version: process.env.npm_package_version ?? "0.2.0",
            environment: this.environment.name,
            uptimeSeconds: Math.round(process.uptime()),
        };
    }
    async ready(reply) {
        const [database, redis] = await Promise.all([
            probe("postgres", () => this.database.db.execute((0, drizzle_orm_1.sql) `SELECT 1`), this.logger),
            probe("redis", () => this.redis.ping(), this.logger),
        ]);
        const ready = database.status === "up" && redis.status === "up";
        if (!ready)
            reply.status(503);
        return { status: ready ? "ready" : "not_ready", database, redis };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)("health"),
    (0, swagger_1.ApiOperation)({
        summary: "Liveness",
        description: "Sam proces. Nie odpytuje bazy ani Redisa — restart instancji nie naprawia niedostępnej zależności.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: health_dto_1.HealthResponseDto }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", health_dto_1.HealthResponseDto)
], HealthController.prototype, "check", null);
__decorate([
    (0, common_1.Get)("ready"),
    (0, swagger_1.ApiOperation)({
        summary: "Readiness",
        description: "PostgreSQL i Redis. 503, gdy którakolwiek zależność nie odpowiada — instancja nie powinna wtedy dostawać ruchu.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: health_dto_1.ReadinessResponseDto }),
    (0, swagger_1.ApiServiceUnavailableResponse)({ type: health_dto_1.ReadinessResponseDto }),
    __param(0, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
exports.HealthController = HealthController = HealthController_1 = __decorate([
    (0, swagger_1.ApiTags)("health"),
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(queue_module_1.REDIS_CONNECTION)),
    __metadata("design:paramtypes", [Object, Function, security_module_1.AppEnvironmentService])
], HealthController);
//# sourceMappingURL=health.controller.js.map