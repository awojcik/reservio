"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the Booking while a payment is in flight.
 *
 * Confirmation happens when the provider's signed webhook reaches the backend,
 * which is moments after the Guest finishes — but not synchronously with it.
 * Rather than have the browser assert success, the page simply asks the server
 * again until the server changes its mind (milestone 08 §39).
 */
export function BookingStatusPoller({
  intervalMs = 3000,
  maxAttempts = 20,
}: {
  intervalMs?: number;
  maxAttempts?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;

    const timer = setInterval(() => {
      attempts += 1;
      // Give up quietly: a Guest who leaves the tab open for an hour should
      // not keep a request going every three seconds.
      if (attempts > maxAttempts) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [router, intervalMs, maxAttempts]);

  return null;
}
