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
exports.PropertiesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const property_dto_1 = require("./dto/property.dto");
const property_stay_query_dto_1 = require("./dto/property-stay-query.dto");
const properties_service_1 = require("./properties.service");
let PropertiesController = class PropertiesController {
    properties;
    constructor(properties) {
        this.properties = properties;
    }
    findOne(slug, stay) {
        return this.properties.findPublished(slug, stay);
    }
};
exports.PropertiesController = PropertiesController;
__decorate([
    (0, common_1.Get)(":slug"),
    (0, swagger_1.ApiOperation)({
        summary: "Szczegóły Property",
        description: "Slug jest publiczną tożsamością routingową; UUID jest akceptowany dla zgodności ze starszymi linkami.",
    }),
    (0, swagger_1.ApiParam)({ name: "slug", example: "baltic-loft-brzezno" }),
    (0, swagger_1.ApiOkResponse)({ type: property_dto_1.PropertyDetailDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Property nie istnieje albo nie jest opublikowane" }),
    __param(0, (0, common_1.Param)("slug")),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, property_stay_query_dto_1.PropertyStayQueryDto]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "findOne", null);
exports.PropertiesController = PropertiesController = __decorate([
    (0, swagger_1.ApiTags)("properties"),
    (0, common_1.Controller)("properties"),
    __metadata("design:paramtypes", [properties_service_1.PropertiesService])
], PropertiesController);
//# sourceMappingURL=properties.controller.js.map