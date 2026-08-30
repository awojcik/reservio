import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { requireHost } from "@/lib/host-session";

export const metadata: Metadata = { title: "Panel gospodarza" };

export default async function HostDashboardPage() {
  const host = await requireHost();
  const client = await createSessionApiClient();
  const [properties, pendingRequests] = await Promise.all([
    client.listHostProperties({ cache: "no-store" }),
    client.listHostBookings({ status: "PENDING_HOST_APPROVAL" }, { cache: "no-store" }),
  ]);

  const published = properties.filter((item) => item.status === "PUBLISHED").length;
  const drafts = properties.filter((item) => item.status === "DRAFT").length;
  const suspended = properties.filter((item) => item.status === "SUSPENDED").length;

  const stats = [
    { label: "obiektów łącznie", value: properties.length },
    { label: "opublikowanych", value: published },
    { label: "szkiców", value: drafts },
    { label: "wycofanych", value: suspended },
  ];

  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Panel gospodarza</p>
      <h1 className="mt-2 text-[32px] leading-tight font-bold tracking-tightest sm:text-[40px]">
        Cześć, {host.displayName}
      </h1>
      <p className="mt-3 max-w-[52ch] text-[16px] text-muted">
        Tutaj zarządzasz swoimi obiektami — od szkicu, przez zdjęcia i cenę, po publikację
        w wyszukiwarce Rezervio.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-[14px] border border-line bg-surface p-4">
            <dt className="text-[13px] font-semibold text-muted">{stat.label}</dt>
            <dd className="mt-1 text-[30px] leading-none font-bold tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {pendingRequests.length > 0 ? (
        <Link
          href="/host/bookings?status=PENDING_HOST_APPROVAL"
          className="mt-6 flex items-center gap-3 rounded-[14px] border border-accent-edge/40 bg-accent/10 px-4 py-3 transition-colors hover:bg-accent/15"
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-extrabold text-ink">
            {pendingRequests.length}
          </span>
          <span className="text-[15px] font-bold">
            {pendingRequests.length === 1
              ? "prośba o rezerwację czeka na Twoją decyzję"
              : "prośby o rezerwację czekają na Twoją decyzję"}
          </span>
        </Link>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/host/properties/new" className={buttonStyles("accent", "lg")}>
          <Plus size={18} strokeWidth={2.6} />
          Dodaj obiekt
        </Link>
        <Link href="/host/properties" className={buttonStyles("outline", "lg")}>
          Zobacz wszystkie obiekty
        </Link>
      </div>

      {properties.length === 0 ? (
        <p className="mt-10 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-8 text-center text-[15px] text-muted">
          Nie masz jeszcze żadnego obiektu. Zacznij od „Dodaj obiekt” — szkic możesz
          uzupełniać stopniowo.
        </p>
      ) : null}
    </div>
  );
}
