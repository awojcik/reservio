"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESCRIPTION_MAX = exports.DESCRIPTION_MIN = exports.TITLE_MAX = exports.TITLE_MIN = exports.MINIMUM_IMAGES = exports.PUBLISH_REQUIREMENTS = void 0;
exports.evaluatePublishReadiness = evaluatePublishReadiness;
exports.PUBLISH_REQUIREMENTS = [
    "TITLE",
    "DESCRIPTION",
    "PROPERTY_TYPE",
    "LOCATION",
    "CAPACITY",
    "PRICE",
    "MINIMUM_IMAGES",
];
exports.MINIMUM_IMAGES = 3;
exports.TITLE_MIN = 5;
exports.TITLE_MAX = 120;
exports.DESCRIPTION_MIN = 80;
exports.DESCRIPTION_MAX = 5000;
const CURRENCIES = new Set(["PLN", "EUR", "USD", "GBP"]);
const PROPERTY_TYPES = new Set(["APARTMENT", "HOUSE", "VILLA", "STUDIO"]);
function evaluatePublishReadiness(property) {
    const missing = [];
    const title = property.title.trim();
    if (title.length < exports.TITLE_MIN || title.length > exports.TITLE_MAX)
        missing.push("TITLE");
    const description = property.description?.trim() ?? "";
    if (description.length < exports.DESCRIPTION_MIN || description.length > exports.DESCRIPTION_MAX) {
        missing.push("DESCRIPTION");
    }
    if (!PROPERTY_TYPES.has(property.propertyType))
        missing.push("PROPERTY_TYPE");
    const locationComplete = property.countryCode.trim().length > 0 &&
        property.city.trim().length > 0 &&
        property.district.trim().length > 0 &&
        property.timeZone.trim().length > 0 &&
        property.latitude !== null &&
        property.longitude !== null;
    if (!locationComplete)
        missing.push("LOCATION");
    if (property.maxGuests < 1 || property.beds < 1 || property.bathrooms < 1) {
        missing.push("CAPACITY");
    }
    if (property.baseDailyRateAmountMinor <= 0 || !CURRENCIES.has(property.currency)) {
        missing.push("PRICE");
    }
    if (property.imageCount < exports.MINIMUM_IMAGES)
        missing.push("MINIMUM_IMAGES");
    return { ready: missing.length === 0, missing };
}
//# sourceMappingURL=publish-readiness.js.map