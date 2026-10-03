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
exports.PropertyNotReadyDto = exports.PublishErrorDto = exports.HostPropertyDetailDto = exports.HostPropertySummaryDto = exports.PublishReadinessDto = exports.HostPropertyPricingDto = exports.HostPropertyCapacityDto = exports.HostPropertyAddressDto = exports.HostPropertyImageDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const schema_1 = require("../../../../infrastructure/database/schema");
const publish_readiness_1 = require("../../../../domain/publish-readiness");
class HostPropertyImageDto {
    id;
    url;
    altText;
    position;
}
exports.HostPropertyImageDto = HostPropertyImageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], HostPropertyImageDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "http://localhost:9000/rezervio-local/properties/…/a.jpg" }),
    __metadata("design:type", String)
], HostPropertyImageDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], HostPropertyImageDto.prototype, "altText", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0, description: "position = 0 oznacza zdjęcie główne" }),
    __metadata("design:type", Number)
], HostPropertyImageDto.prototype, "position", void 0);
class HostPropertyAddressDto {
    addressLine1;
    postalCode;
    city;
    district;
    countryCode;
    timeZone;
    latitude;
    longitude;
}
exports.HostPropertyAddressDto = HostPropertyAddressDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "ul. Morska 12/3" }),
    __metadata("design:type", Object)
], HostPropertyAddressDto.prototype, "addressLine1", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true, example: "80-001" }),
    __metadata("design:type", Object)
], HostPropertyAddressDto.prototype, "postalCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Gdańsk" }),
    __metadata("design:type", String)
], HostPropertyAddressDto.prototype, "city", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Brzeźno" }),
    __metadata("design:type", String)
], HostPropertyAddressDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "PL" }),
    __metadata("design:type", String)
], HostPropertyAddressDto.prototype, "countryCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Europe/Warsaw" }),
    __metadata("design:type", String)
], HostPropertyAddressDto.prototype, "timeZone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: Number, nullable: true, example: 54.40312 }),
    __metadata("design:type", Object)
], HostPropertyAddressDto.prototype, "latitude", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: Number, nullable: true, example: 18.61402 }),
    __metadata("design:type", Object)
], HostPropertyAddressDto.prototype, "longitude", void 0);
class HostPropertyCapacityDto {
    maxGuests;
    bedrooms;
    beds;
    bathrooms;
}
exports.HostPropertyCapacityDto = HostPropertyCapacityDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 4 }),
    __metadata("design:type", Number)
], HostPropertyCapacityDto.prototype, "maxGuests", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 2 }),
    __metadata("design:type", Number)
], HostPropertyCapacityDto.prototype, "bedrooms", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 3 }),
    __metadata("design:type", Number)
], HostPropertyCapacityDto.prototype, "beds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    __metadata("design:type", Number)
], HostPropertyCapacityDto.prototype, "bathrooms", void 0);
class HostPropertyPricingDto {
    baseDailyRateAmountMinor;
    cleaningFeeAmountMinor;
    currency;
}
exports.HostPropertyPricingDto = HostPropertyPricingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 45000, description: "DailyRate w minor units" }),
    __metadata("design:type", Number)
], HostPropertyPricingDto.prototype, "baseDailyRateAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 10000, description: "CleaningFee w minor units" }),
    __metadata("design:type", Number)
], HostPropertyPricingDto.prototype, "cleaningFeeAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "PLN", enum: ["PLN", "EUR", "USD", "GBP"] }),
    __metadata("design:type", String)
], HostPropertyPricingDto.prototype, "currency", void 0);
class PublishReadinessDto {
    ready;
    missing;
}
exports.PublishReadinessDto = PublishReadinessDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: false }),
    __metadata("design:type", Boolean)
], PublishReadinessDto.prototype, "ready", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        isArray: true,
        enum: publish_readiness_1.PUBLISH_REQUIREMENTS,
        example: ["DESCRIPTION", "LOCATION", "MINIMUM_IMAGES"],
    }),
    __metadata("design:type", Array)
], PublishReadinessDto.prototype, "missing", void 0);
class HostPropertySummaryDto {
    id;
    slug;
    status;
    title;
    city;
    coverImage;
    pricing;
    updatedAt;
    publishReadiness;
}
exports.HostPropertySummaryDto = HostPropertySummaryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], HostPropertySummaryDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "apartament-nad-morzem-gdansk" }),
    __metadata("design:type", String)
], HostPropertySummaryDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.PROPERTY_STATUSES }),
    __metadata("design:type", String)
], HostPropertySummaryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Apartament nad morzem" }),
    __metadata("design:type", String)
], HostPropertySummaryDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Gdańsk" }),
    __metadata("design:type", String)
], HostPropertySummaryDto.prototype, "city", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HostPropertyImageDto, nullable: true }),
    __metadata("design:type", Object)
], HostPropertySummaryDto.prototype, "coverImage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HostPropertyPricingDto }),
    __metadata("design:type", HostPropertyPricingDto)
], HostPropertySummaryDto.prototype, "pricing", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "2026-08-28T18:00:00.000Z" }),
    __metadata("design:type", String)
], HostPropertySummaryDto.prototype, "updatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: PublishReadinessDto }),
    __metadata("design:type", PublishReadinessDto)
], HostPropertySummaryDto.prototype, "publishReadiness", void 0);
class HostPropertyDetailDto extends HostPropertySummaryDto {
    description;
    propertyType;
    bookingMode;
    address;
    capacity;
    amenities;
    images;
}
exports.HostPropertyDetailDto = HostPropertyDetailDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], HostPropertyDetailDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: schema_1.PROPERTY_TYPES }),
    __metadata("design:type", String)
], HostPropertyDetailDto.prototype, "propertyType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: schema_1.BOOKING_MODES,
        description: "REQUEST_TO_BOOK wymaga akceptacji gospodarza; INSTANT_BOOK rezerwuje od razu.",
    }),
    __metadata("design:type", String)
], HostPropertyDetailDto.prototype, "bookingMode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HostPropertyAddressDto }),
    __metadata("design:type", HostPropertyAddressDto)
], HostPropertyDetailDto.prototype, "address", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HostPropertyCapacityDto }),
    __metadata("design:type", HostPropertyCapacityDto)
], HostPropertyDetailDto.prototype, "capacity", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], example: ["WIFI", "PARKING"] }),
    __metadata("design:type", Array)
], HostPropertyDetailDto.prototype, "amenities", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [HostPropertyImageDto] }),
    __metadata("design:type", Array)
], HostPropertyDetailDto.prototype, "images", void 0);
class PublishErrorDto {
    field;
    code;
    required;
}
exports.PublishErrorDto = PublishErrorDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "images" }),
    __metadata("design:type", String)
], PublishErrorDto.prototype, "field", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "MINIMUM_IMAGES_REQUIRED" }),
    __metadata("design:type", String)
], PublishErrorDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 3 }),
    __metadata("design:type", Number)
], PublishErrorDto.prototype, "required", void 0);
class PropertyNotReadyDto {
    code;
    errors;
}
exports.PropertyNotReadyDto = PropertyNotReadyDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "PROPERTY_NOT_READY_FOR_PUBLISH" }),
    __metadata("design:type", String)
], PropertyNotReadyDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PublishErrorDto] }),
    __metadata("design:type", Array)
], PropertyNotReadyDto.prototype, "errors", void 0);
//# sourceMappingURL=host-property.dto.js.map