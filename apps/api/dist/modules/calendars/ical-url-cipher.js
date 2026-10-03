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
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const aead_cipher_1 = require("../../common/aead-cipher");
Object.defineProperty(exports, "IcalUrlCipherMisconfigured", { enumerable: true, get: function () { return aead_cipher_1.CipherMisconfigured; } });
let IcalUrlCipher = class IcalUrlCipher {
    cipher;
    constructor(config) {
        this.cipher = new aead_cipher_1.AeadCipher(config.get("ICAL_URL_ENCRYPTION_KEY"), "ICAL_URL_ENCRYPTION_KEY");
    }
    onModuleInit() {
        if (this.cipher.configError)
            throw new aead_cipher_1.CipherMisconfigured(this.cipher.configError);
    }
    encrypt(plaintext) {
        return this.cipher.encrypt(plaintext);
    }
    decrypt(payload) {
        return this.cipher.decrypt(payload);
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
};
exports.IcalUrlCipher = IcalUrlCipher;
exports.IcalUrlCipher = IcalUrlCipher = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], IcalUrlCipher);
//# sourceMappingURL=ical-url-cipher.js.map