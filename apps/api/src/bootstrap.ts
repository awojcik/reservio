import { ValidationPipe } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookie from "@fastify/cookie";

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
  await app.getHttpAdapter().getInstance().register(cookie);

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
