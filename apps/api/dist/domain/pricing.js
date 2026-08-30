"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countNights = countNights;
exports.calculatePriceQuote = calculatePriceQuote;
const common_1 = require("@nestjs/common");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function countNights(checkIn, checkOut) {
    if (!DATE_PATTERN.test(checkIn) || !DATE_PATTERN.test(checkOut)) {
        throw new common_1.BadRequestException("checkIn i checkOut muszą mieć format YYYY-MM-DD");
    }
    const from = Date.parse(`${checkIn}T00:00:00Z`);
    const to = Date.parse(`${checkOut}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) {
        throw new common_1.BadRequestException("checkIn lub checkOut nie jest poprawną datą");
    }
    const nights = Math.round((to - from) / MS_PER_DAY);
    if (nights < 1) {
        throw new common_1.BadRequestException("checkOut musi być późniejszy niż checkIn");
    }
    return nights;
}
function calculatePriceQuote(property, checkIn, checkOut) {
    const nights = countNights(checkIn, checkOut);
    const accommodationAmountMinor = property.baseDailyRateAmountMinor * nights;
    const cleaningFeeAmountMinor = property.cleaningFeeAmountMinor;
    const totalAmountMinor = accommodationAmountMinor + cleaningFeeAmountMinor;
    const marketAmountMinor = property.marketDailyRateAmountMinor === null
        ? null
        : property.marketDailyRateAmountMinor * nights + cleaningFeeAmountMinor;
    const savingAmountMinor = marketAmountMinor === null ? null : Math.max(0, marketAmountMinor - totalAmountMinor);
    return {
        nights,
        accommodationAmountMinor,
        cleaningFeeAmountMinor,
        totalAmountMinor,
        marketAmountMinor,
        savingAmountMinor,
        currency: property.currency,
    };
}
//# sourceMappingURL=pricing.js.map