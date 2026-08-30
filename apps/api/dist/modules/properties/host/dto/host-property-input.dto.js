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
exports.ReorderImagesDto = exports.CreateHostPropertyDto = exports.UpdateHostPropertyDto = exports.HostPricingInputDto = exports.HostCapacityInputDto = exports.HostAddressInputDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const amenities_1 = require("../../../../domain/amenities");
const schema_1 = require("../../../../infrastructure/database/schema");
const publish_readiness_1 = require("../../../../domain/publish-readiness");
const CURRENCIES = ["PLN", "EUR", "USD", "GBP"];
const trimmed = ({ value }) => typeof value === "string" ? value.trim() : value;
const toNumber = ({ value }) => {
    if (typeof value === "number")
        return value;
    if (typeof value === "string") {
        const trimmedValue = value.trim();
        if (trimmedValue === "")
            return value;
        const parsed = Number(trimmedValue);
        return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
};
class HostAddressInputDto {
    addressLine1;
    postalCode;
    city;
    district;
    countryCode;
    timeZone;
    latitude;
    longitude;
}
exports.HostAddressInputDto = HostAddressInputDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "ul. Morska 12/3" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], HostAddressInputDto.prototype, "addressLine1", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "80-001" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], HostAddressInputDto.prototype, "postalCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Gdańsk" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], HostAddressInputDto.prototype, "city", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Brzeźno" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], HostAddressInputDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "PL", description: "Kod ISO-3166-1 alpha-2" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value)),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2),
    __metadata("design:type", String)
], HostAddressInputDto.prototype, "countryCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Europe/Warsaw" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], HostAddressInputDto.prototype, "timeZone", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 54.40312 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    __metadata("design:type", Number)
], HostAddressInputDto.prototype, "latitude", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 18.61402 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    __metadata("design:type", Number)
], HostAddressInputDto.prototype, "longitude", void 0);
class HostCapacityInputDto {
    maxGuests;
    bedrooms;
    beds;
    bathrooms;
}
exports.HostCapacityInputDto = HostCapacityInputDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 4, minimum: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(50),
    __metadata("design:type", Number)
], HostCapacityInputDto.prototype, "maxGuests", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 2, minimum: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(30),
    __metadata("design:type", Number)
], HostCapacityInputDto.prototype, "bedrooms", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 3, minimum: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(60),
    __metadata("design:type", Number)
], HostCapacityInputDto.prototype, "beds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1, minimum: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(30),
    __metadata("design:type", Number)
], HostCapacityInputDto.prototype, "bathrooms", void 0);
class HostPricingInputDto {
    baseDailyRateAmountMinor;
    cleaningFeeAmountMinor;
    currency;
}
exports.HostPricingInputDto = HostPricingInputDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 45000, description: "DailyRate w minor units" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100_000_000),
    __metadata("design:type", Number)
], HostPricingInputDto.prototype, "baseDailyRateAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 10000, description: "CleaningFee w minor units" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toNumber),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100_000_000),
    __metadata("design:type", Number)
], HostPricingInputDto.prototype, "cleaningFeeAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: CURRENCIES, example: "PLN" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(CURRENCIES),
    __metadata("design:type", String)
], HostPricingInputDto.prototype, "currency", void 0);
class UpdateHostPropertyDto {
    title;
    description;
    propertyType;
    bookingMode;
    address;
    capacity;
    pricing;
    amenities;
}
exports.UpdateHostPropertyDto = UpdateHostPropertyDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Apartament nad morzem" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(publish_readiness_1.TITLE_MAX),
    __metadata("design:type", String)
], UpdateHostPropertyDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Przestronny apartament…" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(publish_readiness_1.DESCRIPTION_MAX),
    __metadata("design:type", String)
], UpdateHostPropertyDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: schema_1.PROPERTY_TYPES }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(schema_1.PROPERTY_TYPES),
    __metadata("design:type", String)
], UpdateHostPropertyDto.prototype, "propertyType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: schema_1.BOOKING_MODES }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(schema_1.BOOKING_MODES),
    __metadata("design:type", String)
], UpdateHostPropertyDto.prototype, "bookingMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: HostAddressInputDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => HostAddressInputDto),
    __metadata("design:type", HostAddressInputDto)
], UpdateHostPropertyDto.prototype, "address", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: HostCapacityInputDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => HostCapacityInputDto),
    __metadata("design:type", HostCapacityInputDto)
], UpdateHostPropertyDto.prototype, "capacity", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: HostPricingInputDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => HostPricingInputDto),
    __metadata("design:type", HostPricingInputDto)
], UpdateHostPropertyDto.prototype, "pricing", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: [String],
        enum: amenities_1.AMENITY_CODES,
        description: "Pełna lista kodów Amenity — zastępuje dotychczasowy zestaw",
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(amenities_1.AMENITY_CODES.length),
    (0, class_validator_1.IsIn)(amenities_1.AMENITY_CODES, { each: true }),
    __metadata("design:type", Array)
], UpdateHostPropertyDto.prototype, "amenities", void 0);
class CreateHostPropertyDto {
    title;
    propertyType;
}
exports.CreateHostPropertyDto = CreateHostPropertyDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Apartament nad morzem" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trimmed),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(publish_readiness_1.TITLE_MAX),
    __metadata("design:type", String)
], CreateHostPropertyDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: schema_1.PROPERTY_TYPES, default: "APARTMENT" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(schema_1.PROPERTY_TYPES),
    __metadata("design:type", String)
], CreateHostPropertyDto.prototype, "propertyType", void 0);
class ReorderImagesDto {
    imageIds;
}
exports.ReorderImagesDto = ReorderImagesDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: [String],
        description: "Pełna lista identyfikatorów PropertyImage w docelowej kolejności",
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsUUID)("4", { each: true }),
    __metadata("design:type", Array)
], ReorderImagesDto.prototype, "imageIds", void 0);
//# sourceMappingURL=host-property-input.dto.js.map