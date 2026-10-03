"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureApp = configureApp;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const cookie_1 = __importDefault(require("@fastify/cookie"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const guest_access_service_1 = require("./modules/bookings/guest-access.service");
const security_module_1 = require("./infrastructure/security/security.module");
const http_hooks_1 = require("./infrastructure/security/http-hooks");
const provider_error_filter_1 = require("./infrastructure/security/provider-error.filter");
const security_headers_1 = require("./infrastructure/security/security-headers");
async function configureApp(app) {
    app.setGlobalPrefix("api");
    const instance = app.getHttpAdapter().getInstance();
    await instance.register(cookie_1.default);
    const environment = app.get(security_module_1.AppEnvironmentService);
    (0, http_hooks_1.installRequestContext)(instance);
    (0, http_hooks_1.installOriginProtection)(instance, {
        allowedOrigins: environment.allowedOrigins,
        cookieNames: [
            process.env.SESSION_COOKIE_NAME ?? "rezervio_session",
            guest_access_service_1.GUEST_COOKIE,
        ],
    });
    (0, http_hooks_1.installExtraSecurityHeaders)(instance);
    await instance.register(helmet_1.default, (0, security_headers_1.securityHeadersFor)(environment));
    app.enableCors({
        origin: environment.allowedOrigins,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["content-type", "accept", "idempotency-key", "x-request-id"],
        exposedHeaders: ["x-request-id", "retry-after"],
        credentials: true,
        maxAge: 600,
    });
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
        request.rawBody = body;
        if (body.length === 0) {
            done(null, {});
            return;
        }
        try {
            done(null, JSON.parse(body.toString("utf8")));
        }
        catch {
            done(new common_1.BadRequestException("Nieprawidłowy JSON."), undefined);
        }
    });
    app.useGlobalFilters(new provider_error_filter_1.PaymentProviderExceptionFilter(), new provider_error_filter_1.InventoryProviderExceptionFilter());
    app.useGlobalPipes(new common_1.ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: false },
    }));
    const config = new swagger_1.DocumentBuilder()
        .setTitle("Rezervio API")
        .setDescription("Publiczne API marketplace'u Rezervio oraz panel Host. Kwoty są zwracane w minor units razem z walutą ISO-4217.")
        .setVersion("0.2.0")
        .addCookieAuth("rezervio_session", {
        type: "apiKey",
        in: "cookie",
        name: "rezervio_session",
        description: "Opaque session token ustawiany przez /api/auth/login",
    })
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup("api/docs", app, document, {
        jsonDocumentUrl: "api/openapi.json",
    });
}
//# sourceMappingURL=bootstrap.js.map