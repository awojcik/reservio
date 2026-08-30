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
exports.CalendarExportStatusDto = exports.CalendarExportTokenDto = exports.ExternalCalendarDto = exports.UpdateExternalCalendarDto = exports.CreateExternalCalendarDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const schema_1 = require("../../../infrastructure/database/schema");
const trimmed = ({ value }) => typeof value === "string" ? value.trim() : value;
class CreateExternalCalendarDto {
    provider;
    name;
    importUrl;
}
exports.CreateExternalCalendarDto = CreateExternalCalendarDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.EXTERNAL_CALENDAR_PROVIDERS, example: "AIRBNB" }),
    (0, class_validator_1.IsIn)(schema_1.EXTERNAL_CALENDAR_PROVIDERS),
    __metadata("design:type", String)
], CreateExternalCalendarDto.prototype, "provider", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Airbnb — apartament nad morzem" }),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CreateExternalCalendarDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: "https://www.airbnb.com/calendar/ical/12345.ics?s=secret",
        description: "Adres feedu iCal. Traktowany jak sekret: szyfrowany w bazie i nigdy nie zwracany w całości.",
    }),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CreateExternalCalendarDto.prototype, "importUrl", void 0);
class UpdateExternalCalendarDto {
    name;
    status;
    importUrl;
}
exports.UpdateExternalCalendarDto = UpdateExternalCalendarDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Booking.com — studio" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], UpdateExternalCalendarDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: schema_1.EXTERNAL_CALENDAR_STATUSES }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(schema_1.EXTERNAL_CALENDAR_STATUSES),
    __metadata("design:type", String)
], UpdateExternalCalendarDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Nowy adres feedu; zastępuje poprzedni" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], UpdateExternalCalendarDto.prototype, "importUrl", void 0);
class ExternalCalendarDto {
    id;
    provider;
    name;
    maskedUrl;
    status;
    lastSyncSucceededAt;
    lastSyncFailedAt;
    lastErrorCode;
    lastErrorMessage;
    consecutiveFailures;
    importedBlockCount;
}
exports.ExternalCalendarDto = ExternalCalendarDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], ExternalCalendarDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.EXTERNAL_CALENDAR_PROVIDERS }),
    __metadata("design:type", String)
], ExternalCalendarDto.prototype, "provider", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Airbnb — apartament nad morzem" }),
    __metadata("design:type", String)
], ExternalCalendarDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: "https://www.airbnb.com/…/1234…",
        description: "Zamaskowany adres. Pełny URL nie opuszcza backendu.",
    }),
    __metadata("design:type", String)
], ExternalCalendarDto.prototype, "maskedUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.EXTERNAL_CALENDAR_STATUSES }),
    __metadata("design:type", String)
], ExternalCalendarDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "2026-09-01T10:15:00.000Z" }),
    __metadata("design:type", Object)
], ExternalCalendarDto.prototype, "lastSyncSucceededAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], ExternalCalendarDto.prototype, "lastSyncFailedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "TIMEOUT" }),
    __metadata("design:type", Object)
], ExternalCalendarDto.prototype, "lastErrorCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], ExternalCalendarDto.prototype, "lastErrorMessage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0 }),
    __metadata("design:type", Number)
], ExternalCalendarDto.prototype, "consecutiveFailures", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 4, description: "Liczba terminów zaimportowanych z tego kalendarza" }),
    __metadata("design:type", Number)
], ExternalCalendarDto.prototype, "importedBlockCount", void 0);
class CalendarExportTokenDto {
    url;
    createdAt;
}
exports.CalendarExportTokenDto = CalendarExportTokenDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        example: "http://localhost:3001/api/calendar/ical/abc….ics",
        description: "Pełny adres zwracany wyłącznie przy tworzeniu lub rotacji tokenu.",
    }),
    __metadata("design:type", Object)
], CalendarExportTokenDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-01T10:15:00.000Z" }),
    __metadata("design:type", String)
], CalendarExportTokenDto.prototype, "createdAt", void 0);
class CalendarExportStatusDto {
    active;
    createdAt;
}
exports.CalendarExportStatusDto = CalendarExportStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: true, description: "Czy istnieje aktywny token eksportu" }),
    __metadata("design:type", Boolean)
], CalendarExportStatusDto.prototype, "active", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], CalendarExportStatusDto.prototype, "createdAt", void 0);
//# sourceMappingURL=external-calendar.dto.js.map