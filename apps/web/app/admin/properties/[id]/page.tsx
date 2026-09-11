import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { BookingsTable } from "@/components/admin/BookingsTable";
import { ResyncCalendarButton } from "@/components/admin/ResyncCalendarButton";
import { Field, Section } from "@/components/admin/Section";
import { StatePill } from "@/components/admin/StatusPill";
import { formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Obiekt — admin" };

/**
 * One Property.
 *
 * Whether the Host configured stay information and access data is shown as a
 * yes or no. The door code is AES-GCM ciphertext in the database and stays
 * that way — a support screen that displays it is a support screen that leaks
 * it (milestone 11 §8).
 */
export default async function AdminPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let property;
  try {
    property = await client.getAdminProperty(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="py-8">
      <p className="eyebrow">Obiekt</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] leading-tight font-bold tracking-tightest">{property.title}</h1>
        <StatePill status={property.status} />
      </div>

      <Section title="Obiekt">
        <dl className="grid gap-4 p-4 sm:grid-cols-4">
          <Field label="Gospodarz">
            <Link
              href={`/admin/hosts/${property.hostId}`}
              className="font-bold text-brand underline underline-offset-2"
            >
              {property.hostDisplayName}
            </Link>
          </Field>
          <Field label="Miasto">{property.city}</Field>
          <Field label="Strefa czasowa">{property.timeZone}</Field>
          <Field label="Slug">
            <code className="text-[13px]">{property.slug}</code>
          </Field>
          <Field label="Aktywne blokady">{property.activeBlocks}</Field>
          <Field label="Aktywne rezerwacje">{property.activeBookings}</Field>
          <Field label="Informacje o pobycie">
            {property.stayInformationConfigured ? "skonfigurowane" : "brak"}
          </Field>
          <Field label="Dane dostępu">
            {property.sensitiveAccessConfigured ? "skonfigurowane (zaszyfrowane)" : "brak"}
          </Field>
        </dl>
      </Section>

      <Section
        title="Kalendarze zewnętrzne"
        description="Nieudana synchronizacja nigdy nie kasuje poprzednich blokad."
      >
        {property.calendars.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Brak podpiętych kalendarzy.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {property.calendars.map((calendar) => (
              <li key={calendar.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={calendar.status} />
                <span className="text-[14px] font-bold">
                  {calendar.provider} · {calendar.name}
                </span>
                <span className="text-[13px] text-muted">
                  ostatni sukces {formatInstant(calendar.lastSyncSucceededAt)}
                  {calendar.consecutiveFailures > 0
                    ? ` · ${calendar.consecutiveFailures} błędów z rzędu`
                    : ""}
                  {calendar.lastErrorCode ? ` · ${calendar.lastErrorCode}` : ""}
                </span>
                <span className="ml-auto">
                  <ResyncCalendarButton calendarId={calendar.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Rezerwacje">
        <div className="p-4">
          <BookingsTable rows={property.bookings} />
        </div>
      </Section>
    </div>
  );
}
