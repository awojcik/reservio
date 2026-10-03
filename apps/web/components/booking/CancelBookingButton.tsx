"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Cancellation is irreversible, so it asks first and says plainly what will
 * happen (milestone 05 §57).
 */
export function CancelBookingButton({
  reference,
  awaitingHost,
}: {
  reference: string;
  awaitingHost: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function cancel() {
    setPending(true);
    try {
      await apiClient.cancelBooking(reference);
      showToast(awaitingHost ? "Prośba anulowana." : "Rezerwacja anulowana.");
      router.refresh();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status === 409
          ? "Tej rezerwacji nie można już anulować."
          : "Nie udało się anulować. Spróbuj ponownie.",
      );
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="md" onClick={() => setConfirming(true)}>
        {awaitingHost ? "Anuluj prośbę" : "Anuluj rezerwację"}
      </Button>
    );
  }

  return (
    <div className="rounded-[10px] border border-accent-edge/40 bg-accent/8 px-4 py-3">
      <p className="text-[14px] font-bold">
        {awaitingHost ? "Anulować prośbę?" : "Anulować rezerwację?"}
      </p>
      <p className="mt-1 text-[13px] text-muted">
        {awaitingHost
          ? "Gospodarz nie będzie już mógł jej zaakceptować."
          : "Termin wróci do puli wolnych i ktoś inny będzie mógł go zająć. Tego nie da się cofnąć."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="accent" disabled={pending} onClick={cancel}>
          {pending ? "Anuluję…" : "Tak, anuluj"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Zostaw
        </Button>
      </div>
    </div>
  );
}
