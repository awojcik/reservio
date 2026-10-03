import { BadRequestException, ValidationPipe } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import type { FastifyRequest } from "fastify";

import { GUEST_COOKIE } from "./modules/bookings/guest-access.service";
import { AppEnvironmentService } from "./infrastructure/security/security.module";
import {
  installExtraSecurityHeaders,
  installOriginProtection,
  installRequestContext,
} from "./infrastructure/security/http-hooks";
import {
  InventoryProviderExceptionFilter,
  PaymentProviderExceptionFilter,
} from "./infrastructure/security/provider-error.filter";
import { securityHeadersFor } from "./infrastructure/security/security-headers";

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/**
 * Shared between `main.ts` and the tests, so what is exercised in tests is the
 * pipeline that actually serves traffic: same prefix, same validation, same
 * cookie parsing, same OpenAPI document the frontend client is generated from.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix("api");

  // Sessions are opaque tokens in an HttpOnly cookie; without this plugin the
  // guards would see no cookies at all. Registered on the Fastify instance
  // itself: @fastify/cookie augments FastifyInstance, and that augmented shape
  // does not line up with the plugin type Nest's own `register()` expects.
  const instance = app.getHttpAdapter().getInstance();
  await instance.register(cookie);

  const environment = app.get(AppEnvironmentService);

  // First hook registered, so every later hook and handler — including the
  // rejections below — can be tied back to one request.
  installRequestContext(instance);

  installOriginProtection(instance, {
    allowedOrigins: environment.allowedOrigins,
    cookieNames: [
      process.env.SESSION_COOKIE_NAME ?? "rezervio_session",
      GUEST_COOKIE,
    ],
  });
  installExtraSecurityHeaders(instance);

  /*
   * Registered here rather than in `main.ts` so the headers the tests assert
   * on are the headers production sends. The API's own CSP is deliberately
   * narrow — Stripe Elements is embedded by the *web* app, whose policy lives
   * in `next.config.ts` (milestone 11 §23).
   */
  await instance.register(helmet, securityHeadersFor(environment));

  // Credentials are required so the browser sends the session cookie, which
  // rules out a wildcard origin — the allowed origins must be explicit
  // (milestone 11 §22).
  app.enableCors({
    origin: environment.allowedOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "accept", "idempotency-key", "x-request-id"],
    exposedHeaders: ["x-request-id", "retry-after"],
    credentials: true,
    maxAge: 600,
  });

  /*
   * Keep the raw request body alongside the parsed one.
   *
   * A payment provider signs the exact bytes it sent, so verifying that
   * signature against a re-serialised object would fail on any difference in
   * key order or whitespace. Only the webhook route reads `rawBody`; every
   * other handler keeps receiving the parsed JSON it always did
   * (milestone 08 §17).
   */
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      (request as RawBodyRequest).rawBody = body;

      if (body.length === 0) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch {
        done(new BadRequestException("Nieprawidłowy JSON."), undefined);
      }
    },
  );

  /*
   * A provider refusal is not a crash. Without this filter the adapter's error
   * escapes as a bare 500 and an operator cannot tell "Stripe said no" from
   * "Rezervio fell over" (milestone 11 §15).
   */
  app.useGlobalFilters(
    new PaymentProviderExceptionFilter(),
    new InventoryProviderExceptionFilter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle("Rezervio API")
    .setDescription(
      "Publiczne API marketplace'u Rezervio oraz panel Host. Kwoty są zwracane w minor units razem z walutą ISO-4217.",
    )
    .setVersion("0.2.0")
    .addCookieAuth("rezervio_session", {
      type: "apiKey",
      in: "cookie",
      name: "rezervio_session",
      description: "Opaque session token ustawiany przez /api/auth/login",
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/openapi.json",
  });
}
