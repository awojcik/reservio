"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Adds the same job the periodic sweep adds.
 *
 * Deduplicated by job id, so leaning on the button produces one sync rather
 * than a queue full of identical work — and a failed sync still leaves the
 * previous snapshot untouched (milestone 11 §10).
 */
export function ResyncCalendarButton({ calendarId }: { calendarId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      showToast((await apiClient.resyncCalendar(calendarId)).summary);
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się zlecić synchronizacji.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={running}>
      {running ? "Zlecam…" : "Synchronizuj"}
    </Button>
  );
}
