import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";

import {
  CANCEL_QUEUE,
  HOLD_QUEUE,
  LIFECYCLE_QUEUE,
  NOTIFICATIONS_QUEUE,
  REFUND_QUEUE,
  SETTLEMENT_QUEUE,
  STAY_QUEUE,
  SYNC_QUEUE,
} from "../../infrastructure/queue/queue.module";
import { redactValue } from "../../infrastructure/security/redaction";
import type { FailedJobDto, JobQueueDto, JobsResponseDto } from "./dto/admin-operations.dto";

/**
 * The job registry.
 *
 * Every background job Rezervio runs, named in one place. This is the
 * documentation the milestone asks for (§31) and the thing the panel reads —
 * two copies of the same list would disagree within a month.
 *
 * No new scheduler: these are the queues that already exist, gathered rather
 * than replaced.
 */
export const JOB_REGISTRY: { queue: string; token: symbol; jobs: string[] }[] = [
  { queue: "calendar-sync", token: SYNC_QUEUE, jobs: ["sweep", "sync"] },
  { queue: "booking-hold-expire", token: HOLD_QUEUE, jobs: ["expire", "sweep"] },
  { queue: "booking-lifecycle", token: LIFECYCLE_QUEUE, jobs: ["expire", "reminder", "sweep"] },
  { queue: "notifications", token: NOTIFICATIONS_QUEUE, jobs: ["outbox", "send"] },
  { queue: "payment-refund", token: REFUND_QUEUE, jobs: ["refund"] },
  { queue: "payment-provider-cancel", token: CANCEL_QUEUE, jobs: ["cancel"] },
  {
    queue: "stay-lifecycle",
    token: STAY_QUEUE,
    jobs: [
      "stay-instructions-ready",
      "sensitive-access-ready",
      "stay-checkout-reminder",
      "booking-complete",
      "stay-sweep",
    ],
  },
  {
    queue: "host-settlement",
    token: SETTLEMENT_QUEUE,
    jobs: [
      "settlement-release",
      "settlement-transfer",
      "settlement-reversal",
      "financial-reconciliation",
    ],
  },
];

/** How many failed jobs to pull per queue. Enough to see a pattern, not a dump. */
const FAILED_PER_QUEUE = 25;

/**
 * What the queues are doing, and what has given up.
 *
 * A job that exhausted its attempts is invisible without this: BullMQ keeps it
 * in a failed set nobody looks at, and the email or transfer it represents
 * simply never happened. Making that set visible is most of what "operable"
 * means here (milestone 11 §12, §32).
 */
@Injectable()
export class AdminJobsService {
  private readonly logger = new Logger(AdminJobsService.name);
  private readonly queues: { name: string; jobs: string[]; queue: Queue }[];

  constructor(
    @Inject(SYNC_QUEUE) sync: Queue,
    @Inject(HOLD_QUEUE) hold: Queue,
    @Inject(LIFECYCLE_QUEUE) lifecycle: Queue,
    @Inject(NOTIFICATIONS_QUEUE) notifications: Queue,
    @Inject(REFUND_QUEUE) refund: Queue,
    @Inject(CANCEL_QUEUE) cancel: Queue,
    @Inject(STAY_QUEUE) stay: Queue,
    @Inject(SETTLEMENT_QUEUE) settlement: Queue,
  ) {
    const byToken = new Map<symbol, Queue>([
      [SYNC_QUEUE, sync],
      [HOLD_QUEUE, hold],
      [LIFECYCLE_QUEUE, lifecycle],
      [NOTIFICATIONS_QUEUE, notifications],
      [REFUND_QUEUE, refund],
      [CANCEL_QUEUE, cancel],
      [STAY_QUEUE, stay],
      [SETTLEMENT_QUEUE, settlement],
    ]);

    this.queues = JOB_REGISTRY.map((entry) => ({
      name: entry.queue,
      jobs: entry.jobs,
      queue: byToken.get(entry.token)!,
    }));
  }

  async overview(): Promise<JobsResponseDto> {
    const queues = await Promise.all(this.queues.map((entry) => this.summarise(entry)));
    const failed = (await Promise.all(this.queues.map((entry) => this.failedIn(entry)))).flat();

    failed.sort((a, b) => (b.failedAt ?? "").localeCompare(a.failedAt ?? ""));

    return { queues, failed };
  }

  /** Only the failed set, for the dashboard tile. */
  async failedCounts(): Promise<{ queue: string; failed: number; reachable: boolean }[]> {
    const queues = await Promise.all(this.queues.map((entry) => this.summarise(entry)));
    return queues.map((queue) => ({
      queue: queue.name,
      failed: queue.failed,
      reachable: queue.reachable,
    }));
  }

  /**
   * Puts one failed job back on its queue.
   *
   * `job.retry()` — BullMQ's own re-queue, not a re-created job. The handler
   * runs exactly as it would have, with the same payload and the same
   * idempotency guarantees underneath it: a retried notification still claims
   * the dedup row, a retried transfer still meets the partial unique index
   * (milestone 11 §10).
   */
  async retry(queueName: string, jobId: string): Promise<{ retried: boolean; reason?: string }> {
    const entry = this.queues.find((candidate) => candidate.name === queueName);
    if (!entry) return { retried: false, reason: "UNKNOWN_QUEUE" };

    const job = await entry.queue.getJob(jobId);
    if (!job) return { retried: false, reason: "JOB_NOT_FOUND" };

    const state = await job.getState();
    if (state !== "failed") return { retried: false, reason: `JOB_STATE_${state.toUpperCase()}` };

    await job.retry();
    this.logger.log({ event: "admin.job_retried", queue: queueName, jobId });
    return { retried: true };
  }

  private async summarise(entry: {
    name: string;
    jobs: string[];
    queue: Queue;
  }): Promise<JobQueueDto> {
    try {
      const counts = await entry.queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "completed",
        "failed",
      );

      return {
        name: entry.name,
        jobTypes: entry.jobs,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        reachable: true,
      };
    } catch (error) {
      // Redis being down is itself worth seeing on the screen, and it must not
      // take the whole page with it.
      this.logger.warn({
        event: "admin.queue_unreachable",
        queue: entry.name,
        reason: (error as Error).message,
      });
      return {
        name: entry.name,
        jobTypes: entry.jobs,
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: 0,
        failed: 0,
        reachable: false,
      };
    }
  }

  private async failedIn(entry: { name: string; queue: Queue }): Promise<FailedJobDto[]> {
    try {
      const jobs = await entry.queue.getFailed(0, FAILED_PER_QUEUE - 1);

      return jobs.map((job) => ({
        queue: entry.name,
        id: String(job.id),
        name: job.name,
        attemptsMade: job.attemptsMade,
        // Truncated: a stack trace on an admin table is noise, and a provider
        // message can carry more than a code.
        failedReason: job.failedReason ? job.failedReason.slice(0, 200) : null,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        // Payloads carry ids only by design, but the redactor is applied
        // anyway — the day one does not, this is what stops it (§25).
        data: redactValue(job.data ?? {}) as Record<string, unknown>,
      }));
    } catch {
      return [];
    }
  }
}
