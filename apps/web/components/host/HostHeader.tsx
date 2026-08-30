"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

export function HostHeader({ displayName }: { displayName: string }) {
  const router = useRouter();
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
    <header className="sticky top-0 z-40 h-[72px] border-b border-surface/15 bg-brand">
      <div className="mx-auto flex h-full max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/host" aria-label="Panel gospodarza">
            <Logo size={23} onDark />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Panel gospodarza">
            <Link
              href="/host"
              className="rounded-[10px] px-3 py-2 text-[14px] font-bold text-surface/75 transition-colors hover:bg-surface/10 hover:text-surface"
            >
              Pulpit
            </Link>
            <Link
              href="/host/properties"
              className="rounded-[10px] px-3 py-2 text-[14px] font-bold text-surface/75 transition-colors hover:bg-surface/10 hover:text-surface"
            >
              Obiekty
            </Link>
            <Link
              href="/host/bookings"
              className="rounded-[10px] px-3 py-2 text-[14px] font-bold text-surface/75 transition-colors hover:bg-surface/10 hover:text-surface"
            >
              Rezerwacje
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-[14px] font-semibold text-surface/70 md:inline">
            {displayName}
          </span>
          <Button variant="outline" size="sm" tone="dark" onClick={logout} disabled={leaving}>
            <LogOut size={15} strokeWidth={2.3} />
            Wyloguj
          </Button>
        </div>
      </div>
    </header>
  );
}
