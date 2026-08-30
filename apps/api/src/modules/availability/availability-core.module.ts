import { Module } from "@nestjs/common";

import { AvailabilityService } from "./availability.service";

/**
 * The service alone, with no module dependencies of its own.
 *
 * Kept separate from AvailabilityModule so the Property aggregate can consume
 * it (Property detail reports `available`) while the availability controllers
 * consume the Property aggregate — without the two modules importing each
 * other.
 */
@Module({
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityCoreModule {}
