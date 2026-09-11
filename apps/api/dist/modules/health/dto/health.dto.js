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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadinessResponseDto = exports.DependencyHealthDto = exports.HealthResponseDto = exports.DEPENDENCY_STATUSES = void 0;
const swagger_1 = require("@nestjs/swagger");
exports.DEPENDENCY_STATUSES = ["up", "down"];
class HealthResponseDto {
    status;
    version;
    environment;
    uptimeSeconds;
}
exports.HealthResponseDto = HealthResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "ok" }),
    __metadata("design:type", String)
], HealthResponseDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "0.2.0" }),
    __metadata("design:type", String)
], HealthResponseDto.prototype, "version", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "development", description: "development | test | staging | production" }),
    __metadata("design:type", String)
], HealthResponseDto.prototype, "environment", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1234, description: "Sekundy od startu procesu" }),
    __metadata("design:type", Number)
], HealthResponseDto.prototype, "uptimeSeconds", void 0);
class DependencyHealthDto {
    status;
    latencyMs;
    error;
}
exports.DependencyHealthDto = DependencyHealthDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: exports.DEPENDENCY_STATUSES }),
    __metadata("design:type", String)
], DependencyHealthDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: Number, nullable: true, description: "Czas odpowiedzi w ms" }),
    __metadata("design:type", Object)
], DependencyHealthDto.prototype, "latencyMs", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        description: "Klasa błędu, nigdy treść odpowiedzi ani connection string",
    }),
    __metadata("design:type", Object)
], DependencyHealthDto.prototype, "error", void 0);
class ReadinessResponseDto {
    status;
    database;
    redis;
}
exports.ReadinessResponseDto = ReadinessResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "ready", description: "ready | not_ready" }),
    __metadata("design:type", String)
], ReadinessResponseDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: DependencyHealthDto }),
    __metadata("design:type", DependencyHealthDto)
], ReadinessResponseDto.prototype, "database", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: DependencyHealthDto }),
    __metadata("design:type", DependencyHealthDto)
], ReadinessResponseDto.prototype, "redis", void 0);
//# sourceMappingURL=health.dto.js.map