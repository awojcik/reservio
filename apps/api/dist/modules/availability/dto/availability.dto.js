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
exports.PublicAvailabilityDto = exports.UnavailableRangeDto = exports.HostCalendarDto = exports.HostCalendarBlockDto = exports.CalendarWindowDto = exports.UnblockDatesDto = exports.BlockDatesDto = exports.DateRangeDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const schema_1 = require("../../../infrastructure/database/schema");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }) => typeof value === "string" ? value.trim() : value;
class DateRangeDto {
    startDate;
    endDate;
}
exports.DateRangeDto = DateRangeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-12", description: "Pierwszy dzień zakresu (inclusive)" }),
    (0, class_validator_1.Matches)(DATE, { message: "startDate musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], DateRangeDto.prototype, "startDate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: "2026-09-16",
        description: "Dzień po ostatnim zablokowanym (exclusive)",
    }),
    (0, class_validator_1.Matches)(DATE, { message: "endDate musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], DateRangeDto.prototype, "endDate", void 0);
class BlockDatesDto extends DateRangeDto {
    note;
}
exports.BlockDatesDto = BlockDatesDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Wyjazd właściciela", description: "Notatka prywatna Host" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], BlockDatesDto.prototype, "note", void 0);
class UnblockDatesDto extends DateRangeDto {
}
exports.UnblockDatesDto = UnblockDatesDto;
class CalendarWindowDto {
    from;
    to;
}
exports.CalendarWindowDto = CalendarWindowDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-01" }),
    (0, class_validator_1.Matches)(DATE, { message: "from musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], CalendarWindowDto.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-11-01" }),
    (0, class_validator_1.Matches)(DATE, { message: "to musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], CalendarWindowDto.prototype, "to", void 0);
class HostCalendarBlockDto {
    id;
    startDate;
    endDate;
    sourceType;
    sourceLabel;
    calendarName;
    note;
}
exports.HostCalendarBlockDto = HostCalendarBlockDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], HostCalendarBlockDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-12" }),
    __metadata("design:type", String)
], HostCalendarBlockDto.prototype, "startDate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-16", description: "Exclusive" }),
    __metadata("design:type", String)
], HostCalendarBlockDto.prototype, "endDate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.AVAILABILITY_SOURCE_TYPES }),
    __metadata("design:type", String)
], HostCalendarBlockDto.prototype, "sourceType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Ręczna blokada" }),
    __metadata("design:type", String)
], HostCalendarBlockDto.prototype, "sourceLabel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        description: "Nazwa kalendarza zewnętrznego; null dla blokad ręcznych",
    }),
    __metadata("design:type", Object)
], HostCalendarBlockDto.prototype, "calendarName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, description: "Notatka prywatna Host" }),
    __metadata("design:type", Object)
], HostCalendarBlockDto.prototype, "note", void 0);
class HostCalendarDto {
    propertyId;
    from;
    to;
    blocks;
}
exports.HostCalendarDto = HostCalendarDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], HostCalendarDto.prototype, "propertyId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-01" }),
    __metadata("design:type", String)
], HostCalendarDto.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-11-01" }),
    __metadata("design:type", String)
], HostCalendarDto.prototype, "to", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [HostCalendarBlockDto] }),
    __metadata("design:type", Array)
], HostCalendarDto.prototype, "blocks", void 0);
class UnavailableRangeDto {
    startDate;
    endDate;
}
exports.UnavailableRangeDto = UnavailableRangeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-12" }),
    __metadata("design:type", String)
], UnavailableRangeDto.prototype, "startDate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-16", description: "Exclusive" }),
    __metadata("design:type", String)
], UnavailableRangeDto.prototype, "endDate", void 0);
class PublicAvailabilityDto {
    propertyId;
    from;
    to;
    unavailableRanges;
}
exports.PublicAvailabilityDto = PublicAvailabilityDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], PublicAvailabilityDto.prototype, "propertyId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-09-01" }),
    __metadata("design:type", String)
], PublicAvailabilityDto.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-10-01" }),
    __metadata("design:type", String)
], PublicAvailabilityDto.prototype, "to", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: [UnavailableRangeDto],
        description: "Zajęte terminy. Źródło blokady, notatki i błędy synchronizacji nie są ujawniane.",
    }),
    __metadata("design:type", Array)
], PublicAvailabilityDto.prototype, "unavailableRanges", void 0);
//# sourceMappingURL=availability.dto.js.map