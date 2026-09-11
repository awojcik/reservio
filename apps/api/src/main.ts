import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { validateEnvironment } from "./infrastructure/security/env-validation";

async function bootstrap() {
  /*
   * Before anything else. A missing secret found by the first request that
   * needs it is an incident; the same secret found here is a failed deploy
   * (milestone 11 §26). This is also the guard that refuses to start against a
   * live Stripe key — Rezervio is sandbox-only (§28).
   */
  const environment = validateEnvironment(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify, not Express — required by the milestone and cheaper per request.
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: environment.productionLike }),
    // The JSON parser is installed by `configureApp`: it keeps the raw bytes
    // so a webhook signature can be verified against exactly what was sent.
    { bufferLogs: true, bodyParser: false },
  );

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await configureApp(app);

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });

  for (const warning of environment.warnings) {
    app.get(Logger).warn({ event: "config.warning", message: warning });
  }

  return { port, environment: environment.name };
}

bootstrap().catch((error: unknown) => {
  console.error("API nie wystartowało:", error);
  process.exit(1);
});
