import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/admin/Pagination";
import { ResyncCalendarButton } from "@/components/admin/ResyncCalendarButton";
import { StatusPill } from "@/components/admin/StatusPill";
import { SEVERITY_LABELS, formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Kalendarze — admin" };

const PAGE_SIZE = 50;

/**
 * Imported calendars, worst first.
 *
 * A feed that stopped answering does not free the dates it blocked — a failed
 * sync deliberately leaves the previous snapshot alone — so a stale calendar
 * is a slow, silent problem rather than a loud one. Hence the list
 * (milestone 11 §12).
 */
export default async function AdminCalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1) || 1);

  const client = await createSessionApiClient();
  const calendars = await client.listAdminCalendars(
    { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    { cache: "no-store" },
  );

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Synchronizacja kalendarzy
      </h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Adres feedu jest zaszyfrowany i nie opuszcza backendu — widoczne są wyłącznie
        dostawca, stan i historia błędów.
      </p>

      <div className="mt-6 rounded-card border border-line bg-surface">
        {calendars.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Żaden gospodarz nie podpiął jeszcze kalendarza.
          </p>
        ) : (
          <div className="overflow-x-auto p-4">
            <table className="w-full min-w-[900px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] font-bold tracking-wide text-muted uppercase">
                  <th className="py-2 pr-3">Stan</th>
                  <th className="py-2 pr-3">Obiekt</th>
                  <th className="py-2 pr-3">Dostawca</th>
                  <th className="py-2 pr-3">Ostatni sukces</th>
                  <th className="py-2 pr-3">Ostatni błąd</th>
                  <th className="py-2 pr-3">Serie błędów</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {calendars.items.map((calendar) => (
                  <tr key={calendar.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2.5 pr-3">
                      <StatusPill
                        label={SEVERITY_LABELS[calendar.health]}
                        severity={calendar.health}
                      />
                    </td>
                    <td className="max-w-[220px] truncate py-2.5 pr-3">
                      <Link
                        href={`/admin/properties/${calendar.propertyId}`}
                        className="font-bold text-brand underline underline-offset-2"
                      >
                        {calendar.propertyTitle}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {calendar.provider}
                      <span className="block text-[13px] text-muted">{calendar.name}</span>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {formatInstant(calendar.lastSyncSucceededAt)}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {formatInstant(calendar.lastSyncFailedAt)}
                      {calendar.lastErrorCode ? (
                        <span className="block text-[13px] text-muted">
                          {calendar.lastErrorCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">{calendar.consecutiveFailures}</td>
                    <td className="py-2.5">
                      <ResyncCalendarButton calendarId={calendar.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={calendars.total} />
    </div>
  );
}
