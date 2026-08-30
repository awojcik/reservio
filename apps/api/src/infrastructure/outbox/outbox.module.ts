import { Global, Module } from "@nestjs/common";

import { OutboxService } from "./outbox.service";

/**
 * Global: every module that changes a Booking records its side effects here,
 * and threading the import through each of them would add noise without
 * adding clarity.
 */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
