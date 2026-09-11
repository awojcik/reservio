"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Puts a notification back on the queue the outbox pump feeds.
 *
 * Not a send: delivery still has to claim the unique `dedup_key` row, so a
 * notification that already went out stays sent and a retried one goes out
 * exactly once (milestone 11 §10).
 */
export function RetryNotificationButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      showToast((await apiClient.retryNotification(notificationId)).summary);
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się ponowić powiadomienia.");
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
