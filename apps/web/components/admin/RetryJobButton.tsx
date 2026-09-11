"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Puts one failed job back on its queue.
 *
 * BullMQ re-runs the same job with the same payload, so every idempotency
 * guarantee that applied the first time applies again: a retried notification
 * still claims its dedup row, a retried transfer still meets the partial
 * unique index (milestone 11 §10).
 */
export function RetryJobButton({ queue, jobId }: { queue: string; jobId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      showToast((await apiClient.retryJob(queue, jobId)).summary);
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się ponowić zadania.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={running}>
      {running ? "Ponawiam…" : "Ponów"}
    </Button>
  );
}
