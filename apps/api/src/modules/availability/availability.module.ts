import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PropertiesModule } from "../properties/properties.module";
import { AvailabilityCoreModule } from "./availability-core.module";
import { HostAvailabilityController } from "./host-availability.controller";
import { PublicAvailabilityController } from "./public-availability.controller";

@Module({
  imports: [AuthModule, PropertiesModule, AvailabilityCoreModule],
  controllers: [HostAvailabilityController, PublicAvailabilityController],
})
export class AvailabilityModule {}
