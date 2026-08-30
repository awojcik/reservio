"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IcalParseError = void 0;
exports.parseIcal = parseIcal;
const node_crypto_1 = require("node:crypto");
const ical_js_1 = __importDefault(require("ical.js"));
class IcalParseError extends Error {
    code = "PARSE_ERROR";
}
exports.IcalParseError = IcalParseError;
function toLocalDate(time, timeZone) {
    if (time.isDate) {
        return `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
    }
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(time.toJSDate());
}
function fingerprint(start, end, summary) {
    return `fp-${(0, node_crypto_1.createHash)("sha256").update(`${start}|${end}|${summary}`).digest("hex").slice(0, 32)}`;
}
function parseIcal(source, timeZone) {
    let component;
    try {
        component = new ical_js_1.default.Component(ical_js_1.default.parse(source));
    }
    catch (error) {
        throw new IcalParseError(`Nie udało się sparsować feedu iCal: ${error.message}`);
    }
    const events = [];
    const skipped = [];
    const seen = new Set();
    for (const vevent of component.getAllSubcomponents("vevent")) {
        const uidValue = vevent.getFirstPropertyValue("uid");
        const uid = typeof uidValue === "string" ? uidValue : null;
        const status = vevent.getFirstPropertyValue("status");
        if (typeof status === "string" && status.toUpperCase() === "CANCELLED") {
            skipped.push({ reason: "CANCELLED", uid: uid ?? undefined });
            continue;
        }
        let start;
        let end;
        try {
            start = vevent.getFirstPropertyValue("dtstart");
            end = vevent.getFirstPropertyValue("dtend");
        }
        catch {
            skipped.push({ reason: "INVALID_DATES", uid: uid ?? undefined });
            continue;
        }
        if (!start) {
            skipped.push({ reason: "MISSING_DTSTART", uid: uid ?? undefined });
            continue;
        }
        if (!end) {
            const duration = vevent.getFirstPropertyValue("duration");
            if (!duration) {
                skipped.push({ reason: "MISSING_DTEND", uid: uid ?? undefined });
                continue;
            }
            try {
                end = start.clone();
                end.addDuration(duration);
            }
            catch {
                skipped.push({ reason: "INVALID_DURATION", uid: uid ?? undefined });
                continue;
            }
        }
        const startDate = toLocalDate(start, timeZone);
        const endDate = toLocalDate(end, timeZone);
        const normalisedEnd = endDate > startDate ? endDate : addOneDay(startDate);
        if (normalisedEnd <= startDate) {
            skipped.push({ reason: "EMPTY_RANGE", uid: uid ?? undefined });
            continue;
        }
        const summaryValue = vevent.getFirstPropertyValue("summary");
        const summary = typeof summaryValue === "string" ? summaryValue : "";
        const identity = uid?.trim() || fingerprint(startDate, normalisedEnd, summary);
        if (seen.has(identity)) {
            skipped.push({ reason: "DUPLICATE_UID", uid: identity });
            continue;
        }
        seen.add(identity);
        events.push({ uid: identity, range: { startDate, endDate: normalisedEnd } });
    }
    return { events, skipped };
}
function addOneDay(date) {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000);
    return next.toISOString().slice(0, 10);
}
//# sourceMappingURL=ical-parser.js.map