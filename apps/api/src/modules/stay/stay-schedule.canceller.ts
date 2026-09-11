import { Inject, Injectable, Module } from "@nestjs/common";
import { Queue } from "bullmq";

import {
  STAY_QUEUE,
  type StayLifecycleJob,
} from "../../infrastructure/queue/queue.module";

/**
 * Drops the scheduled stay jobs for a Booking that will not happen.
 *
 * Split out of the worker on purpose: Bookings needs this one call when a
 * Booking is cancelled, and importing the whole stay module — which itself
 * depends on Bookings — would be a cycle for no gain.
 *
 * Tidiness, not correctness: every stay job re-checks that its Booking is
 * still CONFIRMED, so a job left behind does nothing anyway.
 */
export const STAY_JOB_NAMES = [
  "stay-instructions-ready",
  "sensitive-access-ready",
  "stay-checkout-reminder",
  "booking-complete",
] as const;

@Injectable()
export class StayScheduleCanceller {
  constructor(@Inject(STAY_QUEUE) private readonly queue: Queue<StayLifecycleJob>) {}

  async cancelFor(bookingId: string): Promise<void> {
    for (const name of STAY_JOB_NAMES) {
      await this.queue.remove(`${name}-${bookingId}`).catch(() => undefined);
    }
  }
}

@Module({
  providers: [StayScheduleCanceller],
  exports: [StayScheduleCanceller],
})
export class StayScheduleModule {}
