import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * Shown when the API is unreachable. Deliberately explicit rather than falling
 * back to cached or mocked data — a backend outage should be obvious.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-[14px] border border-line bg-surface px-6 py-14 text-center"
    >
      <p className="text-[22px] font-bold tracking-tight">
        Nie udało się pobrać ofert.
      </p>
      <p className="mx-auto mt-2 max-w-[42ch] text-[15px] text-muted">
        {message} Sprawdź, czy API Rezervio działa, i spróbuj ponownie.
      </p>
      <Button className="mt-6" onClick={onRetry}>
        <RefreshCw size={16} strokeWidth={2.4} />
        Spróbuj ponownie
      </Button>
    </div>
  );
}
