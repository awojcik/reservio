"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IcalUrlCipher = exports.IcalUrlCipherMisconfigured = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";
class IcalUrlCipherMisconfigured extends Error {
}
exports.IcalUrlCipherMisconfigured = IcalUrlCipherMisconfigured;
let IcalUrlCipher = class IcalUrlCipher {
    key;
    configError;
    constructor(config) {
        const raw = config.get("ICAL_URL_ENCRYPTION_KEY")?.trim();
        if (!raw) {
            this.key = null;
            this.configError =
                "ICAL_URL_ENCRYPTION_KEY nie jest ustawiony. Wygeneruj: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";
            return;
        }
        const decoded = Buffer.from(raw, "base64");
        if (decoded.length !== KEY_BYTES) {
            this.key = null;
            this.configError = `ICAL_URL_ENCRYPTION_KEY musi mieć ${KEY_BYTES} bajtów po zdekodowaniu base64 (ma ${decoded.length}).`;
            return;
        }
        this.key = decoded;
        this.configError = null;
    }
    onModuleInit() {
        if (this.configError)
            throw new IcalUrlCipherMisconfigured(this.configError);
    }
    encrypt(plaintext) {
        const key = this.requireKey();
        const iv = (0, node_crypto_1.randomBytes)(IV_BYTES);
        const cipher = (0, node_crypto_1.createCipheriv)(ALGORITHM, key, iv);
        const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${VERSION}.${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
    }
    decrypt(payload) {
        const key = this.requireKey();
        const [version, encoded] = payload.split(".", 2);
        if (version !== VERSION || !encoded) {
            throw new IcalUrlCipherMisconfigured("Nieznany format zaszyfrowanego URL.");
        }
        const buffer = Buffer.from(encoded, "base64");
        const iv = buffer.subarray(0, IV_BYTES);
        const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);
        const decipher = (0, node_crypto_1.createDecipheriv)(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    }
    static mask(url) {
        try {
            const parsed = new URL(url);
            const segments = parsed.pathname.split("/").filter(Boolean);
            const tail = segments.length > 0 ? `/…/${segments[segments.length - 1].slice(0, 4)}…` : "/…";
            return `${parsed.protocol}//${parsed.host}${tail}`;
        }
        catch {
            return "…";
        }
    }
    requireKey() {
        if (!this.key)
            throw new IcalUrlCipherMisconfigured(this.configError ?? "Brak klucza.");
        return this.key;
    }
};
exports.IcalUrlCipher = IcalUrlCipher;
exports.IcalUrlCipher = IcalUrlCipher = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], IcalUrlCipher);
//# sourceMappingURL=ical-url-cipher.js.map