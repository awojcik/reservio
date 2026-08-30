"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/** Accept / reject, shown only while a request is still awaiting a decision. */
export function BookingActions({
  bookingId,
  status,
}: {
  bookingId: string;
  status: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const awaitingDecision = status === "PENDING_HOST_APPROVAL";
  const cancellable = awaitingDecision || status === "PENDING_PAYMENT";

  if (!awaitingDecision && !cancellable) return null;

  async function run(action: "accept" | "reject" | "cancel") {
    setPending(action);
    try {
      if (action === "accept") {
        await apiClient.acceptBooking(bookingId);
        showToast("Prośba zaakceptowana — termin jest zablokowany.");
      } else if (action === "reject") {
        await apiClient.rejectBooking(bookingId);
        showToast("Prośba odrzucona.");
      } else {
        await apiClient.cancelHostBooking(bookingId);
        showToast("Rezerwacja anulowana — termin znów jest wolny.");
      }
      router.refresh();
    } catch (error) {
      showToast(describe(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {awaitingDecision ? (
        <>
          <Button
            size="sm"
            variant="accent"
            disabled={pending !== null}
            onClick={() => run("accept")}
          >
            {pending === "accept" ? "Akceptuję…" : "Akceptuj"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() => run("reject")}
          >
            {pending === "reject" ? "Odrzucam…" : "Odrzuć"}
          </Button>
        </>
      ) : null}

      {/* Only for statuses where cancelling still means something; the backend
          verifies the transition regardless (milestone 05 §58). */}
      {cancellable ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={() => run("cancel")}
        >
          {pending === "cancel" ? "Anuluję…" : "Anuluj"}
        </Button>
      ) : null}
    </div>
  );
}

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "Coś poszło nie tak. Spróbuj ponownie.";

  const body = error.body as { code?: string; message?: { code?: string } } | undefined;
  const code = body?.code ?? body?.message?.code;

  if (code === "PROPERTY_NOT_AVAILABLE") {
    // The Stay was taken while the request sat in the inbox.
    return "Ten termin zdążył się zająć — prośba została oznaczona jako wygasła.";
  }
  if (code === "BOOKING_REQUEST_EXPIRED") {
    return "Czas na odpowiedź minął — prośba wygasła.";
  }
  if (code === "BOOKING_NOT_CANCELLABLE") {
    return "Tej rezerwacji nie można już anulować.";
  }
  if (error.status === 409) return "Ta prośba została już rozpatrzona.";
  return "Coś poszło nie tak. Spróbuj ponownie.";
}
