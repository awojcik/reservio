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
const health_dto_1 = require("./dto/health.dto");
let HealthController = HealthController_1 = class HealthController {
    database;
    logger = new common_1.Logger(HealthController_1.name);
    constructor(database) {
        this.database = database;
    }
    async check() {
        try {
            await this.database.db.execute((0, drizzle_orm_1.sql) `SELECT 1`);
            return { status: "ok" };
        }
        catch (error) {
            this.logger.error("database connection error", error);
            throw new common_1.ServiceUnavailableException("Baza danych jest nieosiągalna");
        }
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({
        summary: "Stan usługi",
        description: "Weryfikuje połączenie z PostgreSQL. Niedostępna baza to 503, nie 200.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: health_dto_1.HealthResponseDto }),
    (0, swagger_1.ApiServiceUnavailableResponse)({ description: "Baza danych jest nieosiągalna" }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "check", null);
exports.HealthController = HealthController = HealthController_1 = __decorate([
    (0, swagger_1.ApiTags)("health"),
    (0, common_1.Controller)("health"),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], HealthController);
//# sourceMappingURL=health.controller.js.map