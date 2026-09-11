"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporaryEmailError = exports.PermanentEmailError = exports.NOTIFICATION_RECIPIENTS = void 0;
exports.dedupKeyFor = dedupKeyFor;
exports.NOTIFICATION_RECIPIENTS = {
    BOOKING_REQUEST_CREATED: "HOST",
    BOOKING_REQUEST_REMINDER: "HOST",
    BOOKING_CANCELLED_BY_GUEST: "HOST",
    BOOKING_REQUEST_ACCEPTED: "GUEST",
    BOOKING_REQUEST_REJECTED: "GUEST",
    BOOKING_REQUEST_EXPIRED: "GUEST",
    BOOKING_CANCELLED_BY_HOST: "GUEST",
    BOOKING_CONFIRMED: "GUEST",
    STAY_INSTRUCTIONS_READY: "GUEST",
    SENSITIVE_ACCESS_READY: "GUEST",
    STAY_CHECKOUT_REMINDER: "GUEST",
    BOOKING_MESSAGE_TO_GUEST: "GUEST",
    BOOKING_MESSAGE_TO_HOST: "HOST",
};
function dedupKeyFor(type, bookingId, refId) {
    if (refId && (type === "BOOKING_MESSAGE_TO_HOST" || type === "BOOKING_MESSAGE_TO_GUEST")) {
        return `booking-message:${refId}:${exports.NOTIFICATION_RECIPIENTS[type].toLowerCase()}`;
    }
    const base = `${type.toLowerCase().replace(/_/g, "-")}:${bookingId}`;
    return refId ? `${base}:${refId}` : base;
}
class PermanentEmailError extends Error {
    code;
    permanent = true;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
exports.PermanentEmailError = PermanentEmailError;
class TemporaryEmailError extends Error {
    code;
    permanent = false;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
exports.TemporaryEmailError = TemporaryEmailError;
//# sourceMappingURL=notification.js.map