"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/host", label: "Pulpit" },
  { href: "/host/properties", label: "Obiekty" },
  { href: "/host/calendar", label: "Kalendarz" },
  { href: "/host/bookings", label: "Rezerwacje" },
  { href: "/host/payments", label: "Płatności" },
  { href: "/host/integrations", label: "Integracje" },
];

/**
 * Which tab the Host is on.
 *
 * `/host` is only itself — every other route starts with it, so a prefix test
 * would light up the dashboard everywhere. The rest match their subtree, so
 * the Property editor still shows "Obiekty" as current.
 */
export function isCurrentSection(pathname: string, href: string): boolean {
  if (href === "/host") return pathname === "/host";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function HostHeader({ displayName }: { displayName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await apiClient.logout();
      // A full refresh so every Server Component re-reads the (now absent) session.
      router.replace("/host/login");
      router.refresh();
    } catch {
      showToast("Nie udało się wylogować. Spróbuj ponownie.");
      setLeaving(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-surface/15 bg-brand">
      <div className="mx-auto flex h-[72px] max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/host" aria-label="Panel gospodarza">
            <Logo size={23} onDark />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Panel gospodarza">
            {NAV.map((item) => (
              <HostNavLink
                key={item.href}
                href={item.href}
                label={item.label}
                current={isCurrentSection(pathname, item.href)}
              />
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-[14px] font-semibold text-surface/70 lg:inline">
            {displayName}
          </span>
          <Button variant="outline" size="sm" tone="dark" onClick={logout} disabled={leaving}>
            <LogOut size={15} strokeWidth={2.3} />
            Wyloguj
          </Button>
        </div>
      </div>

      {/*
        On a narrow screen the panel used to have no navigation at all: the
        links were hidden and nothing replaced them, so every section but the
        dashboard was unreachable from the phone.
      */}
      <nav
        className="scroll-quiet mx-auto flex max-w-[1120px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6 md:hidden"
        aria-label="Panel gospodarza"
      >
        {NAV.map((item) => (
          <HostNavLink
            key={item.href}
            href={item.href}
            label={item.label}
            current={isCurrentSection(pathname, item.href)}
          />
        ))}
      </nav>
    </header>
  );
}

function HostNavLink({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-[10px] px-3 py-2 text-[14px] font-bold whitespace-nowrap transition-colors",
        current
          ? "bg-surface/15 text-surface"
          : "text-surface/75 hover:bg-surface/10 hover:text-surface",
      )}
    >
      {label}
    </Link>
  );
}
