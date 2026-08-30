import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AvailabilityCoreModule } from "../availability/availability-core.module";
import { PropertiesModule } from "../properties/properties.module";
import { CalendarExportService } from "./calendar-export.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { CalendarSyncWorker } from "./calendar-sync.worker";
import { ExternalCalendarsService } from "./external-calendars.service";
import { HostCalendarsController } from "./host-calendars.controller";
import { IcalUrlCipher } from "./ical-url-cipher";
import { PublicCalendarController } from "./public-calendar.controller";

@Module({
  imports: [AuthModule, PropertiesModule, AvailabilityCoreModule],
  controllers: [HostCalendarsController, PublicCalendarController],
  providers: [
    ExternalCalendarsService,
    CalendarSyncService,
    CalendarSyncWorker,
    CalendarExportService,
    IcalUrlCipher,
  ],
  exports: [CalendarSyncService, CalendarSyncWorker, IcalUrlCipher],
})
export class CalendarsModule {}
