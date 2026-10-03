import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";

import { DatabaseModule } from "./infrastructure/database/database.module";
import { SecurityModule } from "./infrastructure/security/security.module";
import { currentRequestContext } from "./infrastructure/security/request-context";
import { REDACT_PATHS, redactUrl, redactValue } from "./infrastructure/security/redaction";
import { AdminModule } from "./modules/admin/admin.module";
import { ConnectivityModule } from "./modules/connectivity/connectivity.module";
import { GeocodingModule } from "./modules/geocoding/geocoding.module";
import { OutboxModule } from "./infrastructure/outbox/outbox.module";
import { QueueModule } from "./infrastructure/queue/queue.module";
import { AccountModule } from "./modules/account/account.module";
import { AmenitiesModule } from "./modules/amenities/amenities.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AvailabilityModule } from "./modules/availability/availability.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { CalendarsModule } from "./modules/calendars/calendars.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { SettlementsModule } from "./modules/settlements/settlements.module";
import { StayModule } from "./modules/stay/stay.module";
import { HealthModule } from "./modules/health/health.module";
import { HostOperationsModule } from "./modules/host-operations/host-operations.module";
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
        /**
         * Every line carries the correlation id of the request that caused it,
         * so a Booking that went wrong can be followed across the guard, the
         * service and the provider call without guessing from timestamps
         * (milestone 11 §13).
         */
        customProps: () => {
          const context = currentRequestContext();
          return context
            ? { requestId: context.requestId, ...(context.userId ? { userId: context.userId } : {}) }
            : {};
        },
        // The response Set-Cookie carries the raw session token — logging it
        // would put a working credential in the log file, which is exactly
        // what hashing the token in the database is meant to prevent (§25).
        redact: [...REDACT_PATHS],
        serializers: {
          /**
           * The public iCal export URL carries its token in the path, so the
           * request line itself is a credential. A Host searching their
           * Bookings types a Guest email or surname into `search`, and admin
           * search takes `q`. All of it is masked rather than dropped, so the
           * endpoint stays visible in the logs.
           */
          req(request: {
            url?: string;
            query?: Record<string, unknown>;
            [key: string]: unknown;
          }) {
            if (typeof request.url === "string") {
              request.url = redactUrl(request.url);
            }
            if (request.query) {
              request.query = redactValue(request.query) as Record<string, unknown>;
            }
            return request;
          },
        },
      },
    }),
    DatabaseModule,
    QueueModule,
    SecurityModule,
    OutboxModule,
    StorageModule,
    AuthModule,
    AccountModule,
    AmenitiesModule,
    AvailabilityModule,
    BookingsModule,
    CalendarsModule,
    NotificationsModule,
    PaymentsModule,
    StayModule,
    SettlementsModule,
    MessagingModule,
    HostOperationsModule,
    HealthModule,
    ConnectivityModule,
    GeocodingModule,
    AdminModule,
    PropertiesModule,
    SearchModule,
  ],
})
export class AppModule {}
