"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginRateLimiter = void 0;
const common_1 = require("@nestjs/common");
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
let LoginRateLimiter = class LoginRateLimiter {
    attempts = new Map();
    consume(key) {
        const now = Date.now();
        const entry = this.attempts.get(key);
        if (!entry || entry.resetAt <= now) {
            this.attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
            this.sweep(now);
            return true;
        }
        entry.count += 1;
        return entry.count <= MAX_ATTEMPTS;
    }
    reset(key) {
        this.attempts.delete(key);
    }
    sweep(now) {
        for (const [key, entry] of this.attempts) {
            if (entry.resetAt <= now)
                this.attempts.delete(key);
        }
    }
};
exports.LoginRateLimiter = LoginRateLimiter;
exports.LoginRateLimiter = LoginRateLimiter = __decorate([
    (0, common_1.Injectable)()
], LoginRateLimiter);
//# sourceMappingURL=login-rate-limiter.js.map