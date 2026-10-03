import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GEOCODING_PROVIDER } from "./domain/geocoding-provider";
import { GeocodingService } from "./geocoding.service";
import { HostGeocodingController } from "./host-geocoding.controller";
import { NominatimGeocodingProvider } from "./infrastructure/nominatim.provider";

/**
 * Address → latitude/longitude.
 *
 * One provider behind one interface. The interface exists because the choice
 * of geocoder is an operational decision that may change; a registry of
 * providers does not, because there is exactly one and the second is the right
 * moment to generalise.
 */
@Module({
  imports: [AuthModule],
  controllers: [HostGeocodingController],
  providers: [
    NominatimGeocodingProvider,
    { provide: GEOCODING_PROVIDER, useExisting: NominatimGeocodingProvider },
    GeocodingService,
  ],
  exports: [GeocodingService, GEOCODING_PROVIDER],
})
export class GeocodingModule {}
