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
var SmtpEmailProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmtpEmailProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer_1 = require("nodemailer");
const notification_1 = require("../domain/notification");
let SmtpEmailProvider = SmtpEmailProvider_1 = class SmtpEmailProvider {
    logger = new common_1.Logger(SmtpEmailProvider_1.name);
    transporter;
    from;
    constructor(config) {
        this.from = config.get("EMAIL_FROM") ?? "no-reply@rezervio.local";
        this.transporter = (0, nodemailer_1.createTransport)({
            host: config.get("SMTP_HOST") ?? "localhost",
            port: Number(config.get("SMTP_PORT") ?? 1025),
            secure: config.get("SMTP_SECURE") === "true",
            ...(config.get("SMTP_USER")
                ? {
                    auth: {
                        user: config.get("SMTP_USER"),
                        pass: config.get("SMTP_PASSWORD"),
                    },
                }
                : {}),
        });
    }
    async send(message) {
        try {
            await this.transporter.sendMail({
                from: this.from,
                to: message.to,
                subject: message.subject,
                text: message.text,
                html: message.html,
            });
        }
        catch (error) {
            throw classify(error);
        }
    }
    async onApplicationShutdown() {
        this.transporter.close();
    }
};
exports.SmtpEmailProvider = SmtpEmailProvider;
exports.SmtpEmailProvider = SmtpEmailProvider = SmtpEmailProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SmtpEmailProvider);
function classify(error) {
    const code = error.responseCode;
    const message = error.message ?? "Nie udało się wysłać wiadomości.";
    if (typeof code === "number" && code >= 500 && code < 600) {
        return new notification_1.PermanentEmailError(message, `SMTP_${code}`);
    }
    if (typeof code === "number" && code >= 400 && code < 500) {
        return new notification_1.TemporaryEmailError(message, `SMTP_${code}`);
    }
    const errno = error.code;
    if (errno === "EENVELOPE" || errno === "EMESSAGE") {
        return new notification_1.PermanentEmailError(message, errno);
    }
    return new notification_1.TemporaryEmailError(message, errno ?? "SMTP_UNKNOWN");
}
//# sourceMappingURL=smtp-email-provider.js.map