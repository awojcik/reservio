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
exports.SearchResponseDto = exports.PropertyDetailDto = exports.PropertySummaryDto = exports.PropertyImageDto = exports.PriceQuoteDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class PriceQuoteDto {
    nights;
    accommodationAmountMinor;
    cleaningFeeAmountMinor;
    totalAmountMinor;
    marketAmountMinor;
    savingAmountMinor;
    currency;
}
exports.PriceQuoteDto = PriceQuoteDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 4, description: "Liczba nocy pobytu" }),
    __metadata("design:type", Number)
], PriceQuoteDto.prototype, "nights", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 180000, description: "Nocleg w minor units" }),
    __metadata("design:type", Number)
], PriceQuoteDto.prototype, "accommodationAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 12000, description: "Opłata za sprzątanie w minor units" }),
    __metadata("design:type", Number)
], PriceQuoteDto.prototype, "cleaningFeeAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 192000, description: "Cena całkowita pobytu w minor units" }),
    __metadata("design:type", Number)
], PriceQuoteDto.prototype, "totalAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 210000,
        type: Number,
        nullable: true,
        description: "Cena referencyjna MarketPrice; null, gdy brak wiarygodnego źródła",
    }),
    __metadata("design:type", Object)
], PriceQuoteDto.prototype, "marketAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 18000,
        type: Number,
        nullable: true,
        description: "Oszczędność względem MarketPrice; null, gdy brak MarketPrice",
    }),
    __metadata("design:type", Object)
], PriceQuoteDto.prototype, "savingAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "PLN", description: "Waluta ISO-4217" }),
    __metadata("design:type", String)
], PriceQuoteDto.prototype, "currency", void 0);
class PropertyImageDto {
    url;
    altText;
    position;
}
exports.PropertyImageDto = PropertyImageDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PropertyImageDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], PropertyImageDto.prototype, "altText", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0 }),
    __metadata("design:type", Number)
], PropertyImageDto.prototype, "position", void 0);
class PropertySummaryDto {
    id;
    slug;
    title;
    city;
    district;
    latitude;
    longitude;
    coverImage;
    rating;
    reviewCount;
    bedrooms;
    beds;
    bathrooms;
    maxGuests;
    propertyType;
    amenities;
    distanceToBeachMeters;
    price;
}
exports.PropertySummaryDto = PropertySummaryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: "uuid" }),
    __metadata("design:type", String)
], PropertySummaryDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "baltic-loft-brzezno" }),
    __metadata("design:type", String)
], PropertySummaryDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Baltic Loft" }),
    __metadata("design:type", String)
], PropertySummaryDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Gdańsk" }),
    __metadata("design:type", String)
], PropertySummaryDto.prototype, "city", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Brzeźno" }),
    __metadata("design:type", String)
], PropertySummaryDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 54.40312 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "latitude", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 18.61402 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "longitude", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: PropertyImageDto, nullable: true, required: false }),
    __metadata("design:type", Object)
], PropertySummaryDto.prototype, "coverImage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 9.4, description: "Ocena w skali 0–10" }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "rating", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 127 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "reviewCount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 2 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "bedrooms", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 3 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "beds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "bathrooms", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 4 }),
    __metadata("design:type", Number)
], PropertySummaryDto.prototype, "maxGuests", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ["APARTMENT", "HOUSE", "VILLA", "STUDIO"] }),
    __metadata("design:type", String)
], PropertySummaryDto.prototype, "propertyType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], example: ["POOL", "PARKING"] }),
    __metadata("design:type", Array)
], PropertySummaryDto.prototype, "amenities", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 280, type: Number, nullable: true }),
    __metadata("design:type", Object)
], PropertySummaryDto.prototype, "distanceToBeachMeters", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: PriceQuoteDto }),
    __metadata("design:type", PriceQuoteDto)
], PropertySummaryDto.prototype, "price", void 0);
class PropertyDetailDto extends PropertySummaryDto {
    description;
    images;
    countryCode;
    timeZone;
    baseDailyRateAmountMinor;
    available;
    bookingMode;
    checkInTime;
    checkOutTime;
    houseRules;
}
exports.PropertyDetailDto = PropertyDetailDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Dwupoziomowy loft…" }),
    __metadata("design:type", String)
], PropertyDetailDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PropertyImageDto] }),
    __metadata("design:type", Array)
], PropertyDetailDto.prototype, "images", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "PL" }),
    __metadata("design:type", String)
], PropertyDetailDto.prototype, "countryCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "Europe/Warsaw" }),
    __metadata("design:type", String)
], PropertyDetailDto.prototype, "timeZone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 45000, description: "Stawka za noc w minor units" }),
    __metadata("design:type", Number)
], PropertyDetailDto.prototype, "baseDailyRateAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: Boolean,
        nullable: true,
        description: "Czy Property jest wolne w podanym Stay. null, gdy nie podano checkIn i checkOut.",
    }),
    __metadata("design:type", Object)
], PropertyDetailDto.prototype, "available", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: ["REQUEST_TO_BOOK", "INSTANT_BOOK"],
        description: "Czy rezerwacja wymaga akceptacji gospodarza. Gość musi to wiedzieć przed wysłaniem formularza.",
    }),
    __metadata("design:type", String)
], PropertyDetailDto.prototype, "bookingMode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "15:00", description: "Zameldowanie od, czas lokalny obiektu" }),
    __metadata("design:type", String)
], PropertyDetailDto.prototype, "checkInTime", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "11:00", description: "Wymeldowanie do, czas lokalny obiektu" }),
    __metadata("design:type", String)
], PropertyDetailDto.prototype, "checkOutTime", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: String,
        nullable: true,
        description: "Zasady domu — jedyny publiczny fragment informacji o pobycie",
    }),
    __metadata("design:type", Object)
], PropertyDetailDto.prototype, "houseRules", void 0);
class SearchResponseDto {
    items;
    total;
}
exports.SearchResponseDto = SearchResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PropertySummaryDto] }),
    __metadata("design:type", Array)
], SearchResponseDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 18, description: "Liczba wszystkich pasujących Property" }),
    __metadata("design:type", Number)
], SearchResponseDto.prototype, "total", void 0);
//# sourceMappingURL=property.dto.js.map