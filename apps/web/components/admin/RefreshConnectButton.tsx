"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Asks the provider what state the connected account is really in.
 *
 * A read, not a write: readiness is the provider's answer, and a Settlement
 * waiting on it stays AVAILABLE until that answer changes — which is not an
 * error, just a Host who has not finished onboarding (milestone 11 §10).
 */
export function RefreshConnectButton({ hostId }: { hostId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      showToast((await apiClient.refreshConnectStatus(hostId)).summary);
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się odświeżyć stanu konta.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={running}>
      {running ? "Odświeżam…" : "Odśwież stan konta"}
    </Button>
  );
}
