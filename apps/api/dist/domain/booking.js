"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransition = canTransition;
exports.generateBookingReference = generateBookingReference;
exports.assertCapacity = assertCapacity;
exports.toBookingAmounts = toBookingAmounts;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const ALLOWED_TRANSITIONS = {
    PENDING_HOST_APPROVAL: ["PENDING_PAYMENT", "CANCELLED", "EXPIRED"],
    PENDING_PAYMENT: ["CONFIRMED", "EXPIRED", "CANCELLED"],
    CONFIRMED: ["COMPLETED", "CANCELLED"],
    CANCELLED: [],
    EXPIRED: [],
    COMPLETED: [],
};
function canTransition(from, to) {
    return ALLOWED_TRANSITIONS[from].includes(to);
}
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateBookingReference() {
    const bytes = (0, node_crypto_1.randomBytes)(8);
    const body = Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length])
        .join("")
        .slice(0, 8);
    return `RZV-${body}`;
}
function assertCapacity(guests, maxGuests) {
    if (guests.adults < 1) {
        throw new common_1.BadRequestException("Rezerwacja wymaga co najmniej jednej osoby dorosłej.");
    }
    if (guests.children < 0) {
        throw new common_1.BadRequestException("Liczba dzieci nie może być ujemna.");
    }
    if (guests.adults + guests.children > maxGuests) {
        throw new common_1.BadRequestException(`Ten obiekt przyjmuje maksymalnie ${maxGuests} ${maxGuests === 1 ? "osobę" : "osób"}.`);
    }
}
function toBookingAmounts(quote) {
    const serviceFeeAmountMinor = 0;
    const taxAmountMinor = 0;
    const discountAmountMinor = 0;
    return {
        accommodationAmountMinor: quote.accommodationAmountMinor,
        cleaningFeeAmountMinor: quote.cleaningFeeAmountMinor,
        serviceFeeAmountMinor,
        taxAmountMinor,
        discountAmountMinor,
        totalAmountMinor: quote.accommodationAmountMinor +
            quote.cleaningFeeAmountMinor +
            serviceFeeAmountMinor +
            taxAmountMinor -
            discountAmountMinor,
        currency: quote.currency,
    };
}
//# sourceMappingURL=booking.js.map