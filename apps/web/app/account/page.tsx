import { CalendarDays, Compass, LayoutDashboard, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { TripCard } from "@/components/account/TripCard";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { displayNameFor, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Twoje konto" };

export default async function AccountPage() {
  const identity = await requireUser("/account");
  const client = await createSessionApiClient();

  const [upcoming, pending, recent] = await Promise.all([
    client.listTrips({ category: "UPCOMING", limit: 3 }, { cache: "no-store" }),
    client.listTrips({ category: "PENDING", limit: 3 }, { cache: "no-store" }),
    client.listTrips({ limit: 3 }, { cache: "no-store" }),
  ]);

  const stats = [
    { label: "nadchodzące podróże", value: upcoming.items.length },
    { label: "oczekujące prośby", value: pending.items.length },
  ];

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Twoje konto</p>
      <h1 className="mt-2 text-[32px] leading-tight font-bold tracking-tightest sm:text-[40px]">
        Cześć, {displayNameFor(identity)}
      </h1>
      <p className="mt-3 max-w-[52ch] text-[16px] text-muted">
        Wszystkie Twoje podróże w jednym miejscu.
        {identity.host ? " Obiekty, które wynajmujesz, znajdziesz w panelu gospodarza." : ""}
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:max-w-[420px]">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-[14px] border border-line bg-surface p-4">
            <dt className="text-[13px] font-semibold text-muted">{stat.label}</dt>
            <dd className="mt-1 text-[30px] leading-none font-bold tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/account/trips" className={buttonStyles("primary", "lg")}>
          <CalendarDays size={18} strokeWidth={2.4} />
          Wszystkie podróże
        </Link>
        <Link href="/account/profile" className={buttonStyles("outline", "lg")}>
          <UserRound size={18} strokeWidth={2.4} />
          Profil
        </Link>
        {/* Same account, second role — shown only when the profile exists. */}
        {identity.host ? (
          <Link href="/host" className={buttonStyles("outline", "lg")}>
            <LayoutDashboard size={18} strokeWidth={2.4} />
            Panel gospodarza
          </Link>
        ) : null}
      </div>

      <section className="mt-10">
        <h2 className="text-[22px] font-bold tracking-tight">Ostatnie rezerwacje</h2>

        {recent.items.length === 0 ? (
          <div className="mt-4 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center">
            <p className="text-[15px] text-muted">Nie masz jeszcze żadnych podróży.</p>
            <Link href="/search" className={buttonStyles("accent", "md", "mt-4")}>
              <Compass size={17} strokeWidth={2.4} />
              Znajdź miejsce
            </Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {recent.items.map((trip) => (
              <TripCard key={trip.reference} trip={trip} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
