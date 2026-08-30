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
exports.ConfirmImageDto = exports.UploadUrlDto = exports.CreateUploadUrlDto = exports.MAX_IMAGES_PER_PROPERTY = exports.MAX_IMAGE_BYTES = exports.ALLOWED_IMAGE_TYPES = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
exports.ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
exports.MAX_IMAGE_BYTES = 10 * 1024 * 1024;
exports.MAX_IMAGES_PER_PROPERTY = 30;
class CreateUploadUrlDto {
    fileName;
    contentType;
    sizeBytes;
}
exports.CreateUploadUrlDto = CreateUploadUrlDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "living-room.jpg" }),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === "string" ? value.trim() : value)),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateUploadUrlDto.prototype, "fileName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: exports.ALLOWED_IMAGE_TYPES, example: "image/jpeg" }),
    (0, class_validator_1.IsIn)(exports.ALLOWED_IMAGE_TYPES, {
        message: "Dozwolone formaty to JPEG, PNG i WebP",
    }),
    __metadata("design:type", String)
], CreateUploadUrlDto.prototype, "contentType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 2_450_000, maximum: exports.MAX_IMAGE_BYTES }),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(exports.MAX_IMAGE_BYTES, { message: "Maksymalny rozmiar zdjęcia to 10 MB" }),
    __metadata("design:type", Number)
], CreateUploadUrlDto.prototype, "sizeBytes", void 0);
class UploadUrlDto {
    uploadUrl;
    objectKey;
    expiresInSeconds;
}
exports.UploadUrlDto = UploadUrlDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: "Presigned PUT URL — traktuj jak poświadczenie" }),
    __metadata("design:type", String)
], UploadUrlDto.prototype, "uploadUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: "properties/2b6d…/9f1c….jpg" }),
    __metadata("design:type", String)
], UploadUrlDto.prototype, "objectKey", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 600 }),
    __metadata("design:type", Number)
], UploadUrlDto.prototype, "expiresInSeconds", void 0);
class ConfirmImageDto {
    objectKey;
    altText;
}
exports.ConfirmImageDto = ConfirmImageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: "properties/2b6d…/9f1c….jpg" }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], ConfirmImageDto.prototype, "objectKey", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: "Salon apartamentu" }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === "string" ? value.trim() : value)),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], ConfirmImageDto.prototype, "altText", void 0);
//# sourceMappingURL=host-image.dto.js.map