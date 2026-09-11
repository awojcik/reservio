"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type BookingAccessStatus } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Hands the access details to one Guest ahead of schedule.
 *
 * Scoped to this Booking: the Property's default timing is untouched, so the
 * next Guest still waits the normal amount of time (milestone 09 §20A).
 */
export function SensitiveAccessPanel({
  bookingId,
  initial,
  timeZone,
}: {
  bookingId: string;
  initial: BookingAccessStatus;
  timeZone: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [status, setStatus] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!status.configured) {
    return (
      <Panel>
        <p className="text-[14px] text-muted">
          Ten obiekt nie ma zapisanych danych dostępu. Dodasz je w edycji obiektu.
        </p>
      </Panel>
    );
  }

  async function reveal() {
    setPending(true);
    try {
      setStatus(await apiClient.revealBookingAccess(bookingId));
      showToast("Gość ma już dostęp do danych wejścia.");
      setConfirming(false);
      router.refresh();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status === 409
          ? "Dane dostępu można udostępnić dopiero po potwierdzeniu rezerwacji."
          : "Nie udało się udostępnić danych dostępu.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      {status.available ? (
        <p className="text-[15px] font-semibold">
          Gość widzi dane wejścia
          {status.manualRevealAt ? " — udostępnione ręcznie" : ""}.
        </p>
      ) : (
        <>
          <p className="text-[15px]">
            Domyślnie dostępne:{" "}
            <span className="font-bold">
              {status.scheduledRevealAt ? at(status.scheduledRevealAt, timeZone) : "—"}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Wynika z ustawienia obiektu ({status.revealOffsetHours} h przed zameldowaniem).
          </p>

          {confirming ? (
            <div className="mt-4 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-3">
              <p className="text-[14px] font-semibold">
                Gość otrzyma dostęp do danych wejścia natychmiast.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="accent" disabled={pending} onClick={reveal}>
                  {pending ? "Udostępniam…" : "Tak, udostępnij"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Anuluj
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => setConfirming(true)}
            >
              Udostępnij teraz
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}

function Panel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <section className="mt-6 max-w-[560px] rounded-[14px] border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
        <KeyRound size={17} strokeWidth={2.3} aria-hidden="true" />
        Dane dostępu
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function at(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}
