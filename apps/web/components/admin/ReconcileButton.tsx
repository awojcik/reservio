"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Runs the same reconciliation sweep the scheduler runs.
 *
 * Not a repair button: the sweep releases what is due, asks the provider about
 * transfers it lost track of, retries what failed and reads back payouts. What
 * it cannot explain stays visible rather than being guessed at
 * (milestone 11 §34).
 */
export function ReconcileButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const result = await apiClient.runReconciliation("all");
      showToast(result.summary);
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Rekoncyliacja nie powiodła się.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={running}>
      {running ? "Uruchamiam…" : "Uruchom rekoncyliację"}
    </Button>
  );
}
