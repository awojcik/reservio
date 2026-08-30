"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FetchFailedError = exports.UnsafeUrlError = void 0;
exports.privateHostsAllowed = privateHostsAllowed;
exports.isBlockedAddress = isBlockedAddress;
exports.assertAllowedUrl = assertAllowedUrl;
exports.resolveSafely = resolveSafely;
exports.safeFetchIcal = safeFetchIcal;
const promises_1 = require("node:dns/promises");
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const node_net_1 = require("node:net");
function privateHostsAllowed(allow) {
    return allow === true && process.env.NODE_ENV !== "production";
}
class UnsafeUrlError extends Error {
    code = "SECURITY_REJECTED";
}
exports.UnsafeUrlError = UnsafeUrlError;
class FetchFailedError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
exports.FetchFailedError = FetchFailedError;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const METADATA_HOSTNAMES = new Set([
    "metadata",
    "metadata.google.internal",
    "instance-data",
    "metadata.goog",
]);
function ipv4ToInt(address) {
    return address
        .split(".")
        .reduce((total, octet) => (total << 8) + Number(octet), 0) >>> 0;
}
function isPrivateIPv4(address) {
    const value = ipv4ToInt(address);
    const inRange = (cidr, bits) => (value & (~0 << (32 - bits))) >>> 0 === (ipv4ToInt(cidr) & (~0 << (32 - bits))) >>> 0;
    return (inRange("0.0.0.0", 8) ||
        inRange("10.0.0.0", 8) ||
        inRange("127.0.0.0", 8) ||
        inRange("169.254.0.0", 16) ||
        inRange("172.16.0.0", 12) ||
        inRange("192.0.0.0", 24) ||
        inRange("192.168.0.0", 16) ||
        inRange("100.64.0.0", 10) ||
        inRange("198.18.0.0", 15) ||
        inRange("224.0.0.0", 4) ||
        inRange("240.0.0.0", 4));
}
function isPrivateIPv6(address) {
    const normalised = address.toLowerCase().split("%")[0];
    if (normalised === "::1" || normalised === "::")
        return true;
    if (/^f[cd][0-9a-f]{2}:/.test(normalised))
        return true;
    if (/^fe[89ab][0-9a-f]:/.test(normalised))
        return true;
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped)
        return isPrivateIPv4(mapped[1]);
    return false;
}
function isBlockedAddress(address) {
    const version = (0, node_net_1.isIP)(address);
    if (version === 4)
        return isPrivateIPv4(address);
    if (version === 6)
        return isPrivateIPv6(address);
    return true;
}
function assertAllowedUrl(rawUrl, allowPrivateHosts = false) {
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        throw new UnsafeUrlError("Adres kalendarza nie jest poprawnym URL.");
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        throw new UnsafeUrlError(`Dozwolone są wyłącznie adresy http i https (otrzymano ${url.protocol}).`);
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (METADATA_HOSTNAMES.has(hostname)) {
        throw new UnsafeUrlError("Adres wskazuje na endpoint metadanych chmury.");
    }
    if (privateHostsAllowed(allowPrivateHosts))
        return url;
    if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
        throw new UnsafeUrlError("Adres wskazuje na hosta lokalnego.");
    }
    if ((0, node_net_1.isIP)(hostname) && isBlockedAddress(hostname)) {
        throw new UnsafeUrlError("Adres wskazuje na sieć prywatną lub zastrzeżoną.");
    }
    return url;
}
async function resolveSafely(hostname, allowPrivateHosts = false) {
    const cleaned = hostname.replace(/^\[|\]$/g, "");
    if ((0, node_net_1.isIP)(cleaned)) {
        if (!privateHostsAllowed(allowPrivateHosts) && isBlockedAddress(cleaned)) {
            throw new UnsafeUrlError("Adres wskazuje na sieć prywatną lub zastrzeżoną.");
        }
        return [{ address: cleaned, family: (0, node_net_1.isIP)(cleaned) }];
    }
    let answers;
    try {
        answers = await (0, promises_1.lookup)(cleaned, { all: true });
    }
    catch {
        throw new FetchFailedError(`Nie udało się rozwiązać nazwy ${cleaned}.`, "DNS_ERROR");
    }
    if (answers.length === 0) {
        throw new FetchFailedError(`Nazwa ${cleaned} nie ma adresów.`, "DNS_ERROR");
    }
    if (privateHostsAllowed(allowPrivateHosts))
        return answers;
    for (const answer of answers) {
        if (isBlockedAddress(answer.address)) {
            throw new UnsafeUrlError("Adres kalendarza rozwiązuje się do sieci prywatnej lub zastrzeżonej.");
        }
    }
    return answers;
}
async function safeFetchIcal(rawUrl, options) {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
        const url = assertAllowedUrl(currentUrl, options.allowPrivateHosts);
        const addresses = await resolveSafely(url.hostname, options.allowPrivateHosts);
        const response = await requestOnce(url, addresses, options);
        if (response.redirectTo) {
            if (hop === options.maxRedirects) {
                throw new FetchFailedError("Przekroczono limit przekierowań.", "TOO_MANY_REDIRECTS");
            }
            currentUrl = new URL(response.redirectTo, url).toString();
            continue;
        }
        return { body: response.body, finalUrl: url.toString() };
    }
    throw new FetchFailedError("Przekroczono limit przekierowań.", "TOO_MANY_REDIRECTS");
}
function requestOnce(url, addresses, options) {
    const transport = url.protocol === "https:" ? node_https_1.request : node_http_1.request;
    return new Promise((resolve, reject) => {
        const request = transport(url, {
            method: "GET",
            headers: {
                accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
                "user-agent": "Rezervio/0.3 (+calendar-sync)",
            },
            timeout: options.timeoutMs,
            lookup: (_hostname, lookupOptions, callback) => {
                const chosen = addresses[0];
                if (typeof lookupOptions === "function") {
                    lookupOptions(null, chosen.address, chosen.family);
                    return;
                }
                if (lookupOptions?.all) {
                    callback(null, addresses);
                    return;
                }
                callback(null, chosen.address, chosen.family);
            },
        }, (message) => {
            const status = message.statusCode ?? 0;
            if (status >= 300 && status < 400 && message.headers.location) {
                message.resume();
                resolve({ body: "", redirectTo: message.headers.location });
                return;
            }
            if (status < 200 || status >= 300) {
                message.resume();
                reject(new FetchFailedError(`Serwer odpowiedział ${status}.`, "HTTP_ERROR"));
                return;
            }
            let received = 0;
            const chunks = [];
            message.on("data", (chunk) => {
                received += chunk.length;
                if (received > options.maxBytes) {
                    message.destroy();
                    reject(new FetchFailedError(`Odpowiedź przekracza ${options.maxBytes} bajtów.`, "RESPONSE_TOO_LARGE"));
                    return;
                }
                chunks.push(chunk);
            });
            message.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8") }));
            message.on("error", (error) => reject(new FetchFailedError(error.message, "NETWORK_ERROR")));
        });
        request.on("timeout", () => {
            request.destroy();
            reject(new FetchFailedError("Przekroczono czas oczekiwania.", "TIMEOUT"));
        });
        request.on("error", (error) => reject(new FetchFailedError(error.message, "NETWORK_ERROR")));
        request.end();
    });
}
//# sourceMappingURL=safe-fetch.js.map