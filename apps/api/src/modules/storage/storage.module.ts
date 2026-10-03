import { Global, Module } from "@nestjs/common";

import { OBJECT_STORAGE } from "./object-storage";
import { S3ObjectStorage } from "./s3-object-storage";

/**
 * Global because both the Host image endpoints and the public Listing mappers
 * need to turn an object key into a URL.
 */
@Global()
@Module({
  providers: [S3ObjectStorage, { provide: OBJECT_STORAGE, useExisting: S3ObjectStorage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
