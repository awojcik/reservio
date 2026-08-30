"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordService = exports.MIN_PASSWORD_LENGTH = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const argon2_1 = __importDefault(require("argon2"));
const OPTIONS = {
    type: argon2_1.default.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
};
exports.MIN_PASSWORD_LENGTH = 10;
let PasswordService = class PasswordService {
    dummyHash = null;
    hash(password) {
        return argon2_1.default.hash(password, OPTIONS);
    }
    async verifyOrDummy(hash, password) {
        if (hash !== null)
            return this.verify(hash, password);
        this.dummyHash ??= this.hash((0, node_crypto_1.randomBytes)(24).toString("hex"));
        await this.verify(await this.dummyHash, password);
        return false;
    }
    async verify(hash, password) {
        try {
            return await argon2_1.default.verify(hash, password);
        }
        catch {
            return false;
        }
    }
};
exports.PasswordService = PasswordService;
exports.PasswordService = PasswordService = __decorate([
    (0, common_1.Injectable)()
], PasswordService);
//# sourceMappingURL=password.service.js.map