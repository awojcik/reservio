"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * The safe actions for one connection.
 *
 * Retry, reconcile, disable. There is deliberately nothing that writes a
 * provider state: support asks the system to try again, it does not tell the
 * system what happened elsewhere (milestone 12 §26).
 */
export function IntegrationActions({
  connectionId,
  disabled,
}: {
  connectionId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ summary: string }>) {
    setBusy(true);
    try {
      showToast((await action()).summary);
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się wykonać akcji.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || disabled}
        onClick={() => run(() => apiClient.retryIntegrationSync(connectionId))}
      >
        Ponów synchronizację
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || disabled}
        onClick={() => run(() => apiClient.reconcileIntegration(connectionId))}
      >
        Uzgodnij
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || disabled}
        onClick={() => run(() => apiClient.disableIntegration(connectionId))}
      >
        Wyłącz
      </Button>
    </div>
  );
}
