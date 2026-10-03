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
exports.HostPropertiesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guards_1 = require("../../auth/auth.guards");
const host_image_dto_1 = require("./dto/host-image.dto");
const host_property_input_dto_1 = require("./dto/host-property-input.dto");
const host_property_dto_1 = require("./dto/host-property.dto");
const host_images_service_1 = require("./host-images.service");
const host_properties_service_1 = require("./host-properties.service");
let HostPropertiesController = class HostPropertiesController {
    hostProperties;
    images;
    constructor(hostProperties, images) {
        this.hostProperties = hostProperties;
        this.images = images;
    }
    list(host) {
        return this.hostProperties.list(host.id);
    }
    create(host, dto) {
        return this.hostProperties.create(host.id, dto);
    }
    detail(host, id) {
        return this.hostProperties.detail(host.id, id);
    }
    update(host, id, dto) {
        return this.hostProperties.update(host.id, id, dto);
    }
    publish(host, id) {
        return this.hostProperties.publish(host.id, id);
    }
    unpublish(host, id) {
        return this.hostProperties.unpublish(host.id, id);
    }
    archive(host, id) {
        return this.hostProperties.archive(host.id, id);
    }
    createUploadUrl(host, id, dto) {
        return this.images.createUploadUrl(host.id, id, dto);
    }
    confirmImage(host, id, dto) {
        return this.images.confirm(host.id, id, dto);
    }
    reorderImages(host, id, dto) {
        return this.images.reorder(host.id, id, dto.imageIds);
    }
    removeImage(host, id, imageId) {
        return this.images.remove(host.id, id, imageId);
    }
};
exports.HostPropertiesController = HostPropertiesController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "Lista Property zalogowanego Host" }),
    (0, swagger_1.ApiOkResponse)({ type: [host_property_dto_1.HostPropertySummaryDto] }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({
        summary: "Utworzenie Property",
        description: "Nowe Property powstaje jako DRAFT i może być niekompletne.",
    }),
    (0, swagger_1.ApiCreatedResponse)({ type: host_property_dto_1.HostPropertyDetailDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, host_property_input_dto_1.CreateHostPropertyDto]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Property gospodarza wraz z publishReadiness" }),
    (0, swagger_1.ApiOkResponse)({ type: host_property_dto_1.HostPropertyDetailDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Property nie istnieje lub należy do innego Host" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "detail", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, swagger_1.ApiOperation)({
        summary: "Częściowa aktualizacja Property",
        description: "Zapis draftu nie wymaga kompletności. Nie zmienia hostId, status ani znaczników czasu.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: host_property_dto_1.HostPropertyDetailDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Property nie istnieje lub należy do innego Host" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, host_property_input_dto_1.UpdateHostPropertyDto]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(":id/publish"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Publikacja Property",
        description: "Jawna komenda domenowa. Backend jest źródłem prawdy dla reguł publikacji.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: host_property_dto_1.HostPropertyDetailDto }),
    (0, swagger_1.ApiUnprocessableEntityResponse)({
        type: host_property_dto_1.PropertyNotReadyDto,
        description: "Property nie spełnia wymagań publikacji",
    }),
    (0, swagger_1.ApiConflictResponse)({ description: "Nie można opublikować zarchiwizowanego Property" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "publish", null);
__decorate([
    (0, common_1.Post)(":id/unpublish"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Wycofanie z publikacji",
        description: "PUBLISHED → SUSPENDED. Property znika z publicznego Search.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: host_property_dto_1.HostPropertyDetailDto }),
    (0, swagger_1.ApiConflictResponse)({ description: "Property nie jest opublikowane" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "unpublish", null);
__decorate([
    (0, common_1.Post)(":id/archive"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Archiwizacja Property",
        description: "Ustawia ARCHIVED. Danych nie usuwamy twardo.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: host_property_dto_1.HostPropertyDetailDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "archive", null);
__decorate([
    (0, common_1.Post)(":id/images/upload-url"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Presigned URL do wgrania zdjęcia",
        description: "Klucz obiektu jest generowany po stronie serwera na podstawie id Property.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: host_image_dto_1.UploadUrlDto }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, host_image_dto_1.CreateUploadUrlDto]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "createUploadUrl", null);
__decorate([
    (0, common_1.Post)(":id/images"),
    (0, swagger_1.ApiOperation)({
        summary: "Potwierdzenie wgranego zdjęcia",
        description: "Zapisuje PropertyImage po zakończonym uploadzie do object storage.",
    }),
    (0, swagger_1.ApiCreatedResponse)({ type: [host_property_dto_1.HostPropertyImageDto] }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, host_image_dto_1.ConfirmImageDto]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "confirmImage", null);
__decorate([
    (0, common_1.Put)(":id/images/order"),
    (0, swagger_1.ApiOperation)({
        summary: "Kolejność zdjęć",
        description: "Transakcyjna zmiana position; position = 0 to zdjęcie główne.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: [host_property_dto_1.HostPropertyImageDto] }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, host_property_input_dto_1.ReorderImagesDto]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "reorderImages", null);
__decorate([
    (0, common_1.Delete)(":id/images/:imageId"),
    (0, swagger_1.ApiOperation)({
        summary: "Usunięcie zdjęcia",
        description: "Po usunięciu pozycje są porządkowane do ciągu 0..n-1.",
    }),
    (0, swagger_1.ApiOkResponse)({ type: [host_property_dto_1.HostPropertyImageDto] }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Zdjęcie nie istnieje" }),
    __param(0, (0, auth_guards_1.CurrentHost)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)("imageId", common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], HostPropertiesController.prototype, "removeImage", null);
exports.HostPropertiesController = HostPropertiesController = __decorate([
    (0, swagger_1.ApiTags)("host"),
    (0, swagger_1.ApiCookieAuth)("rezervio_session"),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Brak aktywnej sesji" }),
    (0, swagger_1.ApiForbiddenResponse)({ description: "Konto bez profilu Host" }),
    (0, common_1.UseGuards)(auth_guards_1.HostGuard),
    (0, common_1.Controller)("host/properties"),
    __metadata("design:paramtypes", [host_properties_service_1.HostPropertiesService,
        host_images_service_1.HostImagesService])
], HostPropertiesController);
//# sourceMappingURL=host-properties.controller.js.map