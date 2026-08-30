"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const helmet_1 = __importDefault(require("@fastify/helmet"));
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const nestjs_pino_1 = require("nestjs-pino");
const app_module_1 = require("./app.module");
const bootstrap_1 = require("./bootstrap");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter({ bodyLimit: 1_048_576 }), { bufferLogs: true });
    app.useLogger(app.get(nestjs_pino_1.Logger));
    app.enableShutdownHooks();
    await (0, bootstrap_1.configureApp)(app);
    await app.register(helmet_1.default, {
        contentSecurityPolicy: false,
    });
    app.enableCors({
        origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
    });
    const port = Number(process.env.API_PORT ?? 3001);
    await app.listen({ port, host: "0.0.0.0" });
    return { port };
}
bootstrap().catch((error) => {
    console.error("API nie wystartowało:", error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map