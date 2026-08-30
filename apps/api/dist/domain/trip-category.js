"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRIP_CATEGORIES = void 0;
exports.categorise = categorise;
exports.TRIP_CATEGORIES = ["PENDING", "UPCOMING", "PAST", "CANCELLED"];
function categorise(status, checkOut, today) {
    if (status === "CANCELLED" || status === "EXPIRED")
        return "CANCELLED";
    if (status === "PENDING_HOST_APPROVAL" || status === "PENDING_PAYMENT")
        return "PENDING";
    return checkOut > today ? "UPCOMING" : "PAST";
}
//# sourceMappingURL=trip-category.js.map