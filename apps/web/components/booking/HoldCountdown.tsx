"use client";

import { useEffect, useState } from "react";

import { formatCountdown } from "@/lib/booking";

/**
 * Cosmetic only. The backend decides when a hold has actually lapsed, so a
 * clock that runs fast changes nothing but what this label reads
 * (milestone 04 §37).
 */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const deadline = Date.parse(expiresAt);
  const [remaining, setRemaining] = useState(() => deadline - Date.now());

  useEffect(() => {
    const timer = setInterval(() => setRemaining(deadline - Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  if (remaining <= 0) {
    return (
      <span className="font-bold text-accent-edge">
        czas minął — odśwież, aby zobaczyć aktualny status
      </span>
    );
  }

  return (
    <span className="font-bold tabular-nums">{formatCountdown(remaining)}</span>
  );
}
