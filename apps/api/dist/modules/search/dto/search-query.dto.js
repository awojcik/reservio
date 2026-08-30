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
exports.SearchQueryDto = exports.PROPERTY_TYPE_VALUES = exports.SORT_OPTIONS = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
exports.SORT_OPTIONS = [
    "RECOMMENDED",
    "LOWEST_PRICE",
    "HIGHEST_RATING",
    "CLOSEST_TO_BEACH",
    "BEST_VALUE",
];
exports.PROPERTY_TYPE_VALUES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO"];
const toBoolean = ({ value }) => value === true || value === "true" || value === "1";
const toUpperList = ({ value }) => {
    if (value === undefined || value === null || value === "")
        return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(",");
    return raw.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean);
};
class SearchQueryDto {
    destination;
    checkIn;
    checkOut;
    adults;
    children;
    propertyType;
    pool;
    parking;
    amenities;
    maxPrice;
    maxBeachDistanceMeters;
    minRating;
    minBedrooms;
    sort;
    north;
    south;
    east;
    west;
    limit;
}
exports.SearchQueryDto = SearchQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Gdańsk", description: "Miasto, dzielnica lub fragment nazwy" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "destination", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "2026-09-12", description: "Data przyjazdu (YYYY-MM-DD)" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^\d{4}-\d{2}-\d{2}$/, { message: "checkIn musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "checkIn", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "2026-09-16", description: "Data wyjazdu (YYYY-MM-DD)" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^\d{4}-\d{2}-\d{2}$/, { message: "checkOut musi mieć format YYYY-MM-DD" }),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "checkOut", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 2, minimum: 1, default: 2 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "adults", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 2, minimum: 0, default: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "children", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: exports.PROPERTY_TYPE_VALUES,
        isArray: true,
        description: "Lista rozdzielona przecinkami, np. VILLA,HOUSE",
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toUpperList),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsIn)(exports.PROPERTY_TYPE_VALUES, { each: true }),
    __metadata("design:type", Array)
], SearchQueryDto.prototype, "propertyType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Skrót na amenity POOL" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toBoolean),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SearchQueryDto.prototype, "pool", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Skrót na amenity PARKING" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toBoolean),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SearchQueryDto.prototype, "parking", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: "SEA_VIEW,SAUNA",
        description: "Kody Amenity rozdzielone przecinkami; wymagane wszystkie",
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toUpperList),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], SearchQueryDto.prototype, "amenities", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 250000,
        description: "Maksymalna cena CAŁKOWITA pobytu w minor units (Total Price First), nie cena za noc",
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "maxPrice", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 500,
        description: 'Maksymalna odległość do plaży w metrach; Property bez tej informacji są odfiltrowane',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "maxBeachDistanceMeters", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 9, minimum: 0, maximum: 10 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(10),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "minRating", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 2, minimum: 0, description: "Minimalna liczba sypialni" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "minBedrooms", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: exports.SORT_OPTIONS, default: "RECOMMENDED" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value ? String(value).toUpperCase() : undefined)),
    (0, class_validator_1.IsIn)(exports.SORT_OPTIONS),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "sort", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Północna granica viewportu mapy" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "north", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Południowa granica viewportu mapy" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "south", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Wschodnia granica viewportu mapy" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "east", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: "Zachodnia granica viewportu mapy" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "west", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 100, default: 100, maximum: 200 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(200),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "limit", void 0);
//# sourceMappingURL=search-query.dto.js.map