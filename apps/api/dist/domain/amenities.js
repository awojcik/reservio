"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMENITY_CODES = void 0;
exports.isAmenityCode = isAmenityCode;
exports.AMENITY_CODES = [
    "AIR_CONDITIONING",
    "BALCONY",
    "BBQ",
    "ELEVATOR",
    "FIREPLACE",
    "KITCHEN",
    "PARKING",
    "PET_FRIENDLY",
    "POOL",
    "SAUNA",
    "SEA_VIEW",
    "TERRACE",
    "WASHING_MACHINE",
    "WIFI",
    "WORKSPACE",
];
const CODES = new Set(exports.AMENITY_CODES);
function isAmenityCode(value) {
    return CODES.has(value);
}
//# sourceMappingURL=amenities.js.map