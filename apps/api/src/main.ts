import "reflect-metadata";

import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify, not Express — required by the milestone and cheaper per request.
    new FastifyAdapter({ bodyLimit: 1_048_576 }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await configureApp(app);

  await app.register(helmet, {
    // Swagger UI needs inline styles/scripts; the API itself serves no HTML.
    contentSecurityPolicy: false,
  });

  // Credentials are required so the browser sends the session cookie, which
  // rules out a wildcard origin — the allowed origins must be explicit.
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });

  return { port };
}

bootstrap().catch((error: unknown) => {
  console.error("API nie wystartowało:", error);
  process.exit(1);
});
