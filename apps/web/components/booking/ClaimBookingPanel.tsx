"use client";

import { BookmarkPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button, buttonStyles } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Offers to attach an anonymous Booking to an account.
 *
 * The claim itself needs three things the backend checks: a session, a valid
 * Guest access token for this Booking, and a matching email. Nothing here can
 * shortcut that — this is only the invitation (milestone 06 §18, §21).
 */
export function ClaimBookingPanel({
  reference,
  signedIn,
}: {
  reference: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  const returnTo = `/booking/status/${reference}`;

  async function claim() {
    setPending(true);
    try {
      await apiClient.claimBooking(reference);
      showToast("Podróż zapisana na Twoim koncie.");
      router.push("/account/trips");
      router.refresh();
    } catch (error) {
      showToast(describe(error));
      setPending(false);
    }
  }

  return (
    <div className="mt-6 rounded-[10px] border border-brand/30 bg-brand/6 px-4 py-4">
      <p className="flex items-center gap-2 text-[15px] font-bold">
        <BookmarkPlus size={17} strokeWidth={2.4} />
        Zapisz tę podróż na koncie Rezervio
      </p>
      <p className="mt-1 text-[13px] text-muted">
        Będziesz mieć ją razem z innymi rezerwacjami w „Moje podróże”. Konto nie jest
        wymagane — ta rezerwacja działa też bez niego.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {signedIn ? (
          <Button size="sm" variant="accent" disabled={pending} onClick={claim}>
            {pending ? "Zapisuję…" : "Zapisz na koncie"}
          </Button>
        ) : (
          <>
            <Link
              href={`/register?returnTo=${encodeURIComponent(returnTo)}`}
              className={buttonStyles("accent", "sm")}
            >
              Utwórz konto
            </Link>
            <Link
              href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
              className={buttonStyles("outline", "sm")}
            >
              Mam już konto
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "Nie udało się zapisać podróży.";

  const body = error.body as { code?: string; message?: { code?: string } } | undefined;
  const code = body?.code ?? body?.message?.code;

  if (code === "BOOKING_ALREADY_CLAIMED") {
    return "Ta rezerwacja jest już przypisana do innego konta.";
  }
  if (code === "BOOKING_EMAIL_MISMATCH") {
    return "Rezerwacja została złożona na inny adres email niż ten, na który jesteś zalogowany.";
  }
  if (error.status === 401) return "Otwórz rezerwację linkiem z wiadomości email.";
  return "Nie udało się zapisać podróży.";
}
