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
};
function dedupKeyFor(type, bookingId) {
    return `${type.toLowerCase().replace(/_/g, "-")}:${bookingId}`;
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