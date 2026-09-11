import Link from "next/link";

import type { AdminStripeStatus } from "@rezervio/api-client";

import { Logo } from "@/components/layout/Logo";
import { StripeModeBadge } from "@/components/admin/StripeModeBadge";

const NAV = [
  { href: "/admin", label: "Pulpit" },
  { href: "/admin/search", label: "Szukaj" },
  { href: "/admin/bookings", label: "Rezerwacje" },
  { href: "/admin/operations", label: "Operacje" },
  { href: "/admin/jobs", label: "Zadania" },
  { href: "/admin/integrations", label: "Integracje" },
  { href: "/admin/ical", label: "Kalendarze" },
  { href: "/admin/notifications", label: "Powiadomienia" },
];

/**
 * Admin chrome. The same shell as the Host panel — this is a support tool
 * inside Rezervio, not a second product with its own design language
 * (milestone 11 §35).
 */
export function AdminHeader({ stripe }: { stripe: AdminStripeStatus }) {
  return (
    <header className="sticky top-0 z-40 border-b border-surface/15 bg-brand">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-5">
          <Link href="/admin" aria-label="Panel administracyjny">
            <Logo size={23} onDark />
          </Link>
          <span className="rounded-[6px] border border-surface/30 px-2 py-0.5 text-[11px] font-bold tracking-wide text-surface/80">
            ADMIN
          </span>
        </div>

        <StripeModeBadge stripe={stripe} />
      </div>

      <nav
        className="mx-auto flex max-w-[1280px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6"
        aria-label="Panel administracyjny"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-[10px] px-3 py-1.5 text-[13px] font-bold whitespace-nowrap text-surface/75 transition-colors hover:bg-surface/10 hover:text-surface"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
