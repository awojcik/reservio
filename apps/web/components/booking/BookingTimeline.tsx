import type { BookingTimelineEntry } from "@rezervio/api-client";

const LABELS: Record<string, string> = {
  BOOKING_CREATED: "Prośba wysłana",
  HOST_ACCEPTED: "Gospodarz zaakceptował",
  HOST_REJECTED: "Gospodarz odrzucił",
  REQUEST_EXPIRED: "Prośba wygasła",
  GUEST_CANCELLED: "Anulowane przez gościa",
  HOST_CANCELLED: "Anulowane przez gospodarza",
  HOLD_CREATED: "Termin zablokowany",
  HOLD_EXPIRED: "Blokada terminu wygasła",
  HOLD_RELEASED: "Blokada terminu zwolniona",
};

const WHEN = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A short history of the Booking. Not a status source — just what happened. */
export function BookingTimeline({ entries }: { entries: BookingTimelineEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-[15px] font-bold">Historia</h2>
      <ol className="mt-3 space-y-2.5">
        {entries.map((entry, index) => (
          <li key={`${entry.type}-${index}`} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
            />
            <span className="text-[14px]">
              <span className="font-semibold">{LABELS[entry.type] ?? entry.type}</span>
              <span className="ml-2 text-muted">
                {WHEN.format(new Date(entry.createdAt))}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
