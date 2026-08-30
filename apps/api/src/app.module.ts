import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";

import { DatabaseModule } from "./infrastructure/database/database.module";
import { OutboxModule } from "./infrastructure/outbox/outbox.module";
import { QueueModule } from "./infrastructure/queue/queue.module";
import { AccountModule } from "./modules/account/account.module";
import { AmenitiesModule } from "./modules/amenities/amenities.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AvailabilityModule } from "./modules/availability/availability.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { CalendarsModule } from "./modules/calendars/calendars.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { HealthModule } from "./modules/health/health.module";
import { StorageModule } from "./modules/storage/storage.module";
import { PropertiesModule } from "./modules/properties/properties.module";
import { SearchModule } from "./modules/search/search.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // One .env at the repo root serves every workspace package.
      envFilePath: [".env", "../../.env"],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        // Pretty output locally; plain JSON wherever logs are collected.
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { singleLine: true } },
        // The response Set-Cookie carries the raw session token — logging it
        // would put a working credential in the log file, which is exactly
        // what hashing the token in the database is meant to prevent.
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
        ],
        serializers: {
          /**
           * The public iCal export URL carries its token in the path, so the
           * request line itself is a credential. Masked here rather than
           * dropped, so the endpoint is still visible in the logs.
           */
          req(request: { url?: string; [key: string]: unknown }) {
            if (typeof request.url === "string") {
              request.url = request.url.replace(
                /\/calendar\/ical\/[^/?]+/,
                "/calendar/ical/[redacted].ics",
              );
            }
            return request;
          },
        },
      },
    }),
    DatabaseModule,
    QueueModule,
    OutboxModule,
    StorageModule,
    AuthModule,
    AccountModule,
    AmenitiesModule,
    AvailabilityModule,
    BookingsModule,
    CalendarsModule,
    NotificationsModule,
    HealthModule,
    PropertiesModule,
    SearchModule,
  ],
})
export class AppModule {}
