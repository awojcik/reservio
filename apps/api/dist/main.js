"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const nestjs_pino_1 = require("nestjs-pino");
const app_module_1 = require("./app.module");
const bootstrap_1 = require("./bootstrap");
const env_validation_1 = require("./infrastructure/security/env-validation");
async function bootstrap() {
    const environment = (0, env_validation_1.validateEnvironment)(process.env);
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: environment.productionLike }), { bufferLogs: true, bodyParser: false });
    app.useLogger(app.get(nestjs_pino_1.Logger));
    app.enableShutdownHooks();
    await (0, bootstrap_1.configureApp)(app);
    const port = Number(process.env.API_PORT ?? 3001);
    await app.listen({ port, host: "0.0.0.0" });
    for (const warning of environment.warnings) {
        app.get(nestjs_pino_1.Logger).warn({ event: "config.warning", message: warning });
    }
    return { port, environment: environment.name };
}
bootstrap().catch((error) => {
    console.error("API nie wystartowało:", error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map