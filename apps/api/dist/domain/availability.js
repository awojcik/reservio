"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertValidRange = assertValidRange;
exports.overlaps = overlaps;
exports.isAdjacent = isAdjacent;
exports.isContiguous = isContiguous;
exports.mergeRanges = mergeRanges;
exports.subtractRange = subtractRange;
exports.intersectRange = intersectRange;
exports.addDays = addDays;
exports.today = today;
const common_1 = require("@nestjs/common");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function assertValidRange(range) {
    if (!DATE_PATTERN.test(range.startDate) || !DATE_PATTERN.test(range.endDate)) {
        throw new common_1.BadRequestException("Daty muszą mieć format YYYY-MM-DD");
    }
    if (Number.isNaN(Date.parse(`${range.startDate}T00:00:00Z`))) {
        throw new common_1.BadRequestException(`Niepoprawna data: ${range.startDate}`);
    }
    if (Number.isNaN(Date.parse(`${range.endDate}T00:00:00Z`))) {
        throw new common_1.BadRequestException(`Niepoprawna data: ${range.endDate}`);
    }
    if (range.endDate <= range.startDate) {
        throw new common_1.BadRequestException("endDate musi być późniejszy niż startDate");
    }
}
function overlaps(a, b) {
    return a.startDate < b.endDate && b.startDate < a.endDate;
}
function isAdjacent(a, b) {
    return a.endDate === b.startDate || b.endDate === a.startDate;
}
function isContiguous(a, b) {
    return overlaps(a, b) || isAdjacent(a, b);
}
function mergeRanges(ranges) {
    if (ranges.length === 0)
        return [];
    const sorted = [...ranges].sort((a, b) => a.startDate === b.startDate
        ? a.endDate.localeCompare(b.endDate)
        : a.startDate.localeCompare(b.startDate));
    const merged = [{ ...sorted[0] }];
    for (const range of sorted.slice(1)) {
        const last = merged[merged.length - 1];
        if (isContiguous(last, range)) {
            if (range.endDate > last.endDate)
                last.endDate = range.endDate;
        }
        else {
            merged.push({ ...range });
        }
    }
    return merged;
}
function subtractRange(range, hole) {
    if (!overlaps(range, hole))
        return [{ ...range }];
    const remainder = [];
    if (range.startDate < hole.startDate) {
        remainder.push({ startDate: range.startDate, endDate: hole.startDate });
    }
    if (hole.endDate < range.endDate) {
        remainder.push({ startDate: hole.endDate, endDate: range.endDate });
    }
    return remainder;
}
function intersectRange(a, b) {
    if (!overlaps(a, b))
        return null;
    return {
        startDate: a.startDate > b.startDate ? a.startDate : b.startDate,
        endDate: a.endDate < b.endDate ? a.endDate : b.endDate,
    };
}
function addDays(date, days) {
    const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY);
    return shifted.toISOString().slice(0, 10);
}
function today(timeZone = "UTC") {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}
//# sourceMappingURL=availability.js.map