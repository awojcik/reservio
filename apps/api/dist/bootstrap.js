"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureApp = configureApp;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const cookie_1 = __importDefault(require("@fastify/cookie"));
async function configureApp(app) {
    app.setGlobalPrefix("api");
    await app.getHttpAdapter().getInstance().register(cookie_1.default);
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