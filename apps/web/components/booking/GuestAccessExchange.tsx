"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api";

/**
 * Trades the token from an email link for an HttpOnly cookie, then strips it
 * from the address bar.
 *
 * Leaving the secret in the URL would park it in browser history, in the
 * Referer header of any outbound link, and in whatever the Guest pastes to a
 * friend (milestone 05 §16).
 */
export function GuestAccessExchange({
  reference,
  token,
}: {
  reference: string;
  token: string;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .exchangeBookingAccess(reference, token)
      .then(() => {
        if (cancelled) return;
        // Same path, no token — and a refresh so the server re-reads with the
        // cookie now in place.
        router.replace(`/booking/status/${reference}`);
        router.refresh();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [reference, token, router]);

  return (
    <main className="mx-auto max-w-[640px] px-4 py-16 sm:px-6">
      <div className="rounded-[14px] border border-line bg-surface p-6 text-center">
        {failed ? (
          <>
            <h1 className="text-[20px] font-bold tracking-tight">
              Ten link już nie działa
            </h1>
            <p className="mt-2 text-[15px] text-muted">
              Otwórz najnowszą wiadomość email dotyczącą tej rezerwacji.
            </p>
          </>
        ) : (
          <p className="text-[15px] font-semibold text-muted">Otwieram rezerwację…</p>
        )}
      </div>
    </main>
  );
}
