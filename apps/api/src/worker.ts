import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { validateEnvironment } from "./infrastructure/security/env-validation";

/**
 * The background worker process.
 *
 * Same code, same modules and same image as the API — only without an HTTP
 * server. Every BullMQ worker in the app starts itself from `onModuleInit`,
 * so creating the application context is all it takes to consume the queues;
 * `createApplicationContext` skips controllers and the Fastify adapter, which
 * is exactly the difference we want.
 *
 * Why a separate process at all, when the API can run the workers in-process:
 *
 *   - A calendar sync or a Stripe transfer must not compete with a Guest's
 *     request for the same event loop.
 *   - The API can then be restarted — or run more than once — without
 *     multiplying the repeatable sweeps that schedule themselves at boot.
 *
 * The split is configuration, not a fork: the API container sets every
 * `DISABLE_*_WORKER=true`, this one sets none. Both still *enqueue* jobs,
 * because producing is done through the Queue, never through the Worker.
 */
async function bootstrap() {
  // The same gate as the API: a missing secret found here is a failed deploy
  // rather than a job that fails at 3 a.m. (milestone 11 §26).
  const environment = validateEnvironment(process.env);

  const context = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  const logger = context.get(Logger);
  context.useLogger(logger);

  // SIGTERM from `podman stop` has to reach BullMQ, or a job in flight is
  // killed instead of being returned to the queue.
  context.enableShutdownHooks();

  logger.log({
    event: "worker.started",
    environment: environment.name,
    concurrencyCap: process.env.WORKER_CONCURRENCY ?? "default",
  });

  for (const warning of environment.warnings) {
    logger.warn({ event: "config.warning", message: warning });
  }

  return context;
}

bootstrap().catch((error: unknown) => {
  console.error("Worker nie wystartował:", error);
  process.exit(1);
});
