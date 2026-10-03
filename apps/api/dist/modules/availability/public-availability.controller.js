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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicAvailabilityController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const availability_1 = require("../../domain/availability");
const properties_service_1 = require("../properties/properties.service");
const availability_service_1 = require("./availability.service");
const availability_dto_1 = require("./dto/availability.dto");
let PublicAvailabilityController = class PublicAvailabilityController {
    availability;
    properties;
    constructor(availability, properties) {
        this.availability = availability;
        this.properties = properties;
    }
    async availabilityFor(slug, window) {
        const property = await this.properties.findPublishedSummary(slug);
        const blocks = await this.availability.getBlocks(property.id, {
            startDate: window.from,
            endDate: window.to,
        });
        const unavailableRanges = (0, availability_1.mergeRanges)(blocks.map((block) => ({ startDate: block.startDate, endDate: block.endDate })));
        return {
            propertyId: property.id,
            from: window.from,
            to: window.to,
            unavailableRanges,
        };
    }
};
exports.PublicAvailabilityController = PublicAvailabilityController;
__decorate([
    (0, common_1.Get)(":slug/availability"),
    (0, swagger_1.ApiOperation)({
        summary: "Zajęte terminy Property",
        description: "Zakresy niedostępności dla opublikowanego Property. Źródło blokady, notatki Host i status synchronizacji nie są ujawniane.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: availability_dto_1.PublicAvailabilityDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Property nie istnieje albo nie jest opublikowane" }),
    __param(0, (0, common_1.Param)("slug")),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, availability_dto_1.CalendarWindowDto]),
    __metadata("design:returntype", Promise)
], PublicAvailabilityController.prototype, "availabilityFor", null);
exports.PublicAvailabilityController = PublicAvailabilityController = __decorate([
    (0, swagger_1.ApiTags)("properties"),
    (0, common_1.Controller)("properties"),
    __metadata("design:paramtypes", [availability_service_1.AvailabilityService,
        properties_service_1.PropertiesService])
], PublicAvailabilityController);
//# sourceMappingURL=public-availability.controller.js.map