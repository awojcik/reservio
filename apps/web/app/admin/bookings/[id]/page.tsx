import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { IssueList } from "@/components/admin/IssueList";
import { MoneyTrail } from "@/components/admin/MoneyTrail";
import { Field, Section } from "@/components/admin/Section";
import { StatePill } from "@/components/admin/StatusPill";
import { formatInstant, formatMinor } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Rezerwacja — admin" };

/**
 * One Booking, end to end.
 *
 * The screen exists to answer a single question — *where did this stop* — so
 * Payment, Refund, Settlement, Transfer and Payout are laid out in the order
 * money moves, beside the calendar block, the notifications and the audit
 * trail. Five different things, never conflated (milestone 11 §7).
 */
export default async function AdminBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let booking;
  try {
    booking = await client.getAdminBooking(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="py-8">
      <p className="eyebrow">Rezerwacja</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] leading-tight font-bold tracking-tightest">
          {booking.reference}
        </h1>
        <StatePill status={booking.status} />
        {booking.statusReason ? (
          <span className="text-[14px] text-muted">{booking.statusReason}</span>
        ) : null}
      </div>

      <Section title="Rezerwacja">
        <dl className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Gość">
            {booking.guestName}
            <span className="block text-[14px] text-muted">{booking.guestEmailMasked}</span>
            {booking.guestUserId ? (
              <Link
                href={`/admin/users/${booking.guestUserId}`}
                className="text-[14px] font-bold text-brand underline underline-offset-2"
              >
                Konto gościa
              </Link>
            ) : (
              <span className="block text-[13px] text-muted">Rezerwacja bez konta</span>
            )}
          </Field>
          <Field label="Gospodarz">
            <Link
              href={`/admin/hosts/${booking.hostId}`}
              className="font-bold text-brand underline underline-offset-2"
            >
              {booking.hostDisplayName}
            </Link>
            <span className="block text-[14px] text-muted">
              {booking.hostEmailMasked ?? "konto bez logowania"}
            </span>
          </Field>
          <Field label="Obiekt">
            <Link
              href={`/admin/properties/${booking.propertyId}`}
              className="font-bold text-brand underline underline-offset-2"
            >
              {booking.propertyTitle}
            </Link>
          </Field>
          <Field label="Pobyt">
            {booking.checkIn} → {booking.checkOut}
          </Field>
          <Field label="Goście">
            {booking.adults} dorosłych, {booking.children} dzieci
          </Field>
          <Field label="Kwota">
            {formatMinor(booking.totalAmountMinor, booking.currency)}
            <span className="block text-[13px] text-muted">
              {booking.bookingMode} · {formatInstant(booking.createdAt)}
            </span>
          </Field>
        </dl>
      </Section>

      <Section
        title="Droga pieniędzy"
        description="Płatność, zwrot, rozliczenie, przelew i wypłata to pięć różnych rzeczy. Sandbox Stripe — realne pieniądze się nie poruszają."
      >
        <MoneyTrail booking={booking} />
      </Section>

      {booking.issues.length > 0 ? (
        <Section
          title="Problemy operacyjne"
          description="Wyliczone z tych samych tabel co reszta widoku."
        >
          <div className="p-4">
            <IssueList issues={booking.issues} />
          </div>
        </Section>
      ) : null}

      <Section
        title="Blokada terminu"
        description="Potwierdzona rezerwacja blokuje kalendarz wierszem BOOKING — bez terminu ważności."
      >
        {booking.availability.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Brak blokady — termin jest wolny.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {booking.availability.map((block) => (
              <li key={block.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={block.source} />
                <span className="text-[14px]">
                  {block.startDate} → {block.endDate}
                </span>
                {block.holdStatus ? (
                  <span className="text-[13px] text-muted">
                    Hold {block.holdStatus} · wygasa {formatInstant(block.holdExpiresAt)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Powiadomienia"
        description={`Rozmowa w rezerwacji: ${booking.messageCount} wiadomości.`}
      >
        {booking.notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Nie wysłano jeszcze żadnego powiadomienia.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {booking.notifications.map((notification) => (
              <li key={notification.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={notification.status} />
                <span className="text-[14px] font-bold">{notification.type}</span>
                <span className="text-[14px] text-muted">
                  {notification.recipientType} · {notification.recipientMasked}
                </span>
                <span className="ml-auto text-[13px] text-muted">
                  {notification.attemptCount} prób
                  {notification.lastErrorCode ? ` · ${notification.lastErrorCode}` : ""}
                  {notification.sentAt ? ` · ${formatInstant(notification.sentAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Historia rezerwacji">
        <ol className="divide-y divide-line/60">
          {booking.events.map((event, index) => (
            <li key={`${event.type}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[14px] font-bold">{event.type}</span>
              <span className="text-[13px] text-muted">{event.actorType}</span>
              <span className="ml-auto text-[13px] text-muted">
                {formatInstant(event.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {booking.adminActions.length > 0 ? (
        <Section title="Akcje wsparcia dla tej rezerwacji">
          <ul className="divide-y divide-line/60">
            {booking.adminActions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={action.status} />
                <span className="text-[14px] font-bold">{action.actionType}</span>
                <span className="text-[14px] text-muted">{action.summary ?? "—"}</span>
                <span className="ml-auto text-[13px] text-muted">
                  {action.adminEmail} · {formatInstant(action.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
