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
exports.TripsQueryDto = exports.TripsPageDto = exports.TripDto = exports.UpdateProfileDto = exports.ProfileDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const trip_category_1 = require("../../../domain/trip-category");
const booking_dto_1 = require("../../bookings/dto/booking.dto");
const trimmed = ({ value }) => typeof value === "string" ? value.trim() : value;
class ProfileDto {
    id;
    email;
    firstName;
    lastName;
    phone;
    preferredLocale;
    isHost;
}
exports.ProfileDto = ProfileDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], ProfileDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "anna@example.com", description: "Tożsamość logowania, tylko do odczytu" }),
    __metadata("design:type", String)
], ProfileDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], ProfileDto.prototype, "firstName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], ProfileDto.prototype, "lastName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], ProfileDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "pl" }),
    __metadata("design:type", Object)
], ProfileDto.prototype, "preferredLocale", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: Boolean, description: "Czy konto ma profil gospodarza" }),
    __metadata("design:type", Boolean)
], ProfileDto.prototype, "isHost", void 0);
class UpdateProfileDto {
    firstName;
    lastName;
    phone;
    preferredLocale;
}
exports.UpdateProfileDto = UpdateProfileDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Anna" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "firstName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Kowalska" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "lastName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "+48 600 100 200" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "pl", enum: ["pl", "en"] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["pl", "en"]),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "preferredLocale", void 0);
class TripDto extends booking_dto_1.BookingDto {
    category;
    propertyCity;
    coverImageUrl;
    propertySlug;
}
exports.TripDto = TripDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: trip_category_1.TRIP_CATEGORIES }),
    __metadata("design:type", String)
], TripDto.prototype, "category", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "Gdańsk" }),
    __metadata("design:type", Object)
], TripDto.prototype, "propertyCity", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        description: "Okładka zapisana przy rezerwacji; działa też po archiwizacji obiektu",
    }),
    __metadata("design:type", Object)
], TripDto.prototype, "coverImageUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        description: "Slug obiektu, gdy wciąż jest opublikowany; null po wycofaniu",
    }),
    __metadata("design:type", Object)
], TripDto.prototype, "propertySlug", void 0);
class TripsPageDto {
    items;
    nextCursor;
}
exports.TripsPageDto = TripsPageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [TripDto] }),
    __metadata("design:type", Array)
], TripsPageDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        description: "Kursor do kolejnej strony; null, gdy to ostatnia",
    }),
    __metadata("design:type", Object)
], TripsPageDto.prototype, "nextCursor", void 0);
class TripsQueryDto {
    category;
    limit;
    cursor;
}
exports.TripsQueryDto = TripsQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: trip_category_1.TRIP_CATEGORIES }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(trip_category_1.TRIP_CATEGORIES),
    __metadata("design:type", String)
], TripsQueryDto.prototype, "category", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 20, default: 20, maximum: 50 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(50),
    __metadata("design:type", Number)
], TripsQueryDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Kursor z poprzedniej strony" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], TripsQueryDto.prototype, "cursor", void 0);
//# sourceMappingURL=account.dto.js.map