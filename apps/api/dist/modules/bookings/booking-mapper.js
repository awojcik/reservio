"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canCancel = canCancel;
exports.canPay = canPay;
exports.toBookingDto = toBookingDto;
exports.toHostBookingDto = toHostBookingDto;
function price(booking) {
    return {
        accommodationAmountMinor: booking.accommodationAmountMinor,
        cleaningFeeAmountMinor: booking.cleaningFeeAmountMinor,
        serviceFeeAmountMinor: booking.serviceFeeAmountMinor,
        taxAmountMinor: booking.taxAmountMinor,
        discountAmountMinor: booking.discountAmountMinor,
        totalAmountMinor: booking.totalAmountMinor,
        currency: booking.currency,
    };
}
function canCancel(booking) {
    return (booking.status === "PENDING_HOST_APPROVAL" || booking.status === "PENDING_PAYMENT");
}
function canPay(booking, holdExpiresAt) {
    return (booking.status === "PENDING_PAYMENT" &&
        holdExpiresAt !== null &&
        holdExpiresAt.getTime() > Date.now());
}
function timeline(events) {
    return events.map((event) => ({
        type: event.type,
        actorType: event.actorType,
        createdAt: event.createdAt.toISOString(),
    }));
}
function toBookingDto(booking, holdExpiresAt, events = [], payment = null) {
    return {
        reference: booking.publicReference,
        status: booking.status,
        statusReason: booking.statusReason,
        bookingMode: booking.bookingMode,
        propertyTitle: booking.propertyTitleSnapshot,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        adults: booking.adults,
        children: booking.children,
        price: price(booking),
        holdExpiresAt: holdExpiresAt?.toISOString() ?? null,
        hostResponseDeadlineAt: booking.hostResponseDeadlineAt?.toISOString() ?? null,
        createdAt: booking.createdAt.toISOString(),
        timeline: timeline(events),
        allowedActions: {
            canCancel: canCancel(booking),
            claimed: booking.guestUserId !== null,
            canPay: canPay(booking, holdExpiresAt),
        },
        payment,
    };
}
function toHostBookingDto(booking, holdExpiresAt, events = [], payment = null) {
    return {
        ...toBookingDto(booking, holdExpiresAt, events, payment),
        id: booking.id,
        propertyId: booking.propertyId,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        hostRespondedAt: booking.hostRespondedAt?.toISOString() ?? null,
    };
}
//# sourceMappingURL=booking-mapper.js.map