import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AvailabilityCoreModule } from "../availability/availability-core.module";
import { HostImagesService } from "./host/host-images.service";
import { ArchivedImagesService } from "./images/archived-images.service";
import { ImageVariantsService } from "./images/image-variants.service";
import { ImageVariantsWorker } from "./images/image-variants.worker";
import { HostPropertiesController } from "./host/host-properties.controller";
import { HostPropertiesService } from "./host/host-properties.service";
import { PropertiesController } from "./properties.controller";
import { PropertiesService } from "./properties.service";

/**
 * One module for the Property aggregate (domain language §24): the public
 * Listing and the Host editor are two views of the same thing, not two
 * services that could drift apart.
 */
@Module({
  imports: [AuthModule, AvailabilityCoreModule],
  controllers: [PropertiesController, HostPropertiesController],
  providers: [
    PropertiesService,
    HostPropertiesService,
    HostImagesService,
    ImageVariantsService,
    ArchivedImagesService,
    ImageVariantsWorker,
  ],
  // Availability and calendar endpoints hang off the same Property aggregate
  // and reuse its ownership check rather than re-implementing one.
  exports: [PropertiesService, HostPropertiesService],
})
export class PropertiesModule {}
