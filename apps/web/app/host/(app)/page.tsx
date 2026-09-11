import { CalendarDays, LogIn, LogOut, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import type { OperationalBooking } from "@rezervio/api-client";

import { AttentionList } from "@/components/host/AttentionList";
import { OperationalBookingCard } from "@/components/host/OperationalBookingCard";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { requireHost } from "@/lib/host-session";

export const metadata: Metadata = { title: "Panel gospodarza" };

/**
 * Action-first: what needs a decision comes before anything countable
 * (milestone 07 §4). The whole screen is one request — the dashboard is a read
 * model over PostgreSQL, assembled server-side (§6).
 */
export default async function HostDashboardPage() {
  const host = await requireHost();
  const client = await createSessionApiClient();
  const dashboard = await client.getHostDashboard({ cache: "no-store" });

  const { attention, today, pendingRequests, upcomingStays, properties, calendarSync } =
    dashboard;

  const todayLabel = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${today.date}T12:00:00Z`));

  return (
    <div className="py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Panel gospodarza</p>
          <h1 className="mt-2 text-[32px] leading-tight font-bold tracking-tightest sm:text-[40px]">
            Cześć, {host.displayName}
          </h1>
          <p className="mt-2 text-[15px] text-muted first-letter:uppercase">{todayLabel}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/host/calendar" className={buttonStyles("outline", "md")}>
            <CalendarDays size={17} strokeWidth={2.4} />
            Kalendarz
          </Link>
          <Link href="/host/properties/new" className={buttonStyles("accent", "md")}>
            <Plus size={17} strokeWidth={2.6} />
            Dodaj obiekt
          </Link>
        </div>
      </div>

      {properties.total === 0 ? (
        <p className="mt-8 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
          Nie masz jeszcze żadnego obiektu. Zacznij od „Dodaj obiekt” — szkic możesz
          uzupełniać stopniowo.
        </p>
      ) : null}

      <Section title="Wymaga uwagi" className="mt-10">
        <AttentionList items={attention} />
      </Section>

      <Section title="Dziś" className="mt-12">
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <TodayColumn
            icon={<LogIn size={16} strokeWidth={2.5} aria-hidden="true" />}
            title="Przyjazdy"
            bookings={today.arrivals}
            empty="Dziś nikt nie przyjeżdża."
          />
          <TodayColumn
            icon={<LogOut size={16} strokeWidth={2.5} aria-hidden="true" />}
            title="Wyjazdy"
            bookings={today.departures}
            empty="Dziś nikt nie wyjeżdża."
          />
        </div>
      </Section>

      <Section
        title="Prośby o rezerwację"
        action={
          pendingRequests.length > 0 ? (
            <Link
              href="/host/bookings?status=PENDING_HOST_APPROVAL"
              className="text-[14px] font-bold underline underline-offset-4"
            >
              Wszystkie
            </Link>
          ) : null
        }
        className="mt-12"
      >
        {pendingRequests.length === 0 ? (
          <Empty>Żadna prośba nie czeka na decyzję.</Empty>
        ) : (
          <ul className="mt-4 space-y-3">
            {pendingRequests.map((booking) => (
              <OperationalBookingCard key={booking.id} booking={booking} showActions />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Najbliższe pobyty"
        action={
          <Link
            href="/host/bookings?sort=STAY_DATE_ASC&status=CONFIRMED"
            className="text-[14px] font-bold underline underline-offset-4"
          >
            Wszystkie
          </Link>
        }
        className="mt-12"
      >
        {upcomingStays.length === 0 ? (
          <Empty>Brak potwierdzonych pobytów przed Tobą.</Empty>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcomingStays.map((booking) => (
              <OperationalBookingCard key={booking.id} booking={booking} />
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Section title="Twoje obiekty">
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <Stat label="łącznie" value={properties.total} />
            <Stat label="opublikowanych" value={properties.published} />
            <Stat label="szkiców" value={properties.draft} />
            <Stat label="wycofanych" value={properties.suspended} />
          </dl>
          <Link
            href="/host/properties"
            className="mt-3 inline-block text-[14px] font-bold underline underline-offset-4"
          >
            Zarządzaj obiektami
          </Link>
        </Section>

        <Section title="Synchronizacja kalendarzy">
          {calendarSync.active === 0 && calendarSync.disabled === 0 ? (
            <Empty>
              Nie podłączyłeś żadnego kalendarza zewnętrznego. Import z Booking.com czy
              Airbnb ustawisz w kalendarzu obiektu.
            </Empty>
          ) : (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                <Stat label="aktywnych" value={calendarSync.active} />
                <Stat label="aktualnych" value={calendarSync.healthy} />
                <Stat label="z błędem" value={calendarSync.failed} />
                <Stat label="nieodświeżonych" value={calendarSync.stale} />
              </dl>
              {calendarSync.failed + calendarSync.stale > 0 ? (
                <p className="mt-3 text-[14px] text-muted">
                  Szczegóły znajdziesz w „Wymaga uwagi” — każdy wpis prowadzi do kalendarza
                  właściwego obiektu.
                </p>
              ) : null}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  className,
  children,
}: Readonly<{
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TodayColumn({
  icon,
  title,
  bookings,
  empty,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  bookings: OperationalBooking[];
  empty: string;
}>) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
        {icon}
        {title}
        <span className="text-muted tabular-nums">({bookings.length})</span>
      </h3>
      {bookings.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="mt-3 space-y-3">
          {bookings.map((booking) => (
            <OperationalBookingCard key={booking.id} booking={booking} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4">
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="mt-1 text-[28px] leading-none font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Empty({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="mt-3 rounded-[14px] border border-dashed border-line bg-surface/60 px-4 py-6 text-[14px] text-muted">
      {children}
    </p>
  );
}
