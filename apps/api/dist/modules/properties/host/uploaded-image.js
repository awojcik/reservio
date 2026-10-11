"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectImageFormat = detectImageFormat;
exports.assertUploadedImage = assertUploadedImage;
const common_1 = require("@nestjs/common");
const host_image_dto_1 = require("./dto/host-image.dto");
const SIGNATURES = [
    { format: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    { format: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    {
        format: "image/webp",
        bytes: [
            0x52, 0x49, 0x46, 0x46,
            null, null, null, null,
            0x57, 0x45, 0x42, 0x50,
        ],
    },
];
function detectImageFormat(head) {
    for (const { format, bytes } of SIGNATURES) {
        if (head.length < bytes.length)
            continue;
        if (bytes.every((byte, index) => byte === null || head[index] === byte)) {
            return format;
        }
    }
    return null;
}
function assertUploadedImage(object) {
    if (object === null) {
        throw new common_1.BadRequestException("Nie znaleziono wgranego pliku. Spróbuj wgrać zdjęcie ponownie.");
    }
    if (object.sizeBytes === 0) {
        throw new common_1.BadRequestException("Wgrany plik jest pusty.");
    }
    if (object.sizeBytes > host_image_dto_1.MAX_IMAGE_BYTES) {
        throw new common_1.BadRequestException(`Maksymalny rozmiar zdjęcia to ${host_image_dto_1.MAX_IMAGE_LABEL}.`);
    }
    const format = detectImageFormat(object.head);
    if (format === null) {
        throw new common_1.BadRequestException("Plik nie jest obrazem JPEG, PNG ani WebP.");
    }
    return format;
}
//# sourceMappingURL=uploaded-image.js.map