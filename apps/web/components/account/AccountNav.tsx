"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonStyles } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Header navigation for a signed-in visitor. The Host link appears only when
 * the account actually has a Host profile — same account, one extra role.
 */
export function AccountNav({ isHost }: { isHost: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await apiClient.logout();
      router.replace("/");
      router.refresh();
    } catch {
      showToast("Nie udało się wylogować. Spróbuj ponownie.");
      setLeaving(false);
    }
  }

  return (
    <>
      {/*
        Shown on every width. Hiding it below `sm` left a Guest on a phone with
        no route to their own bookings at all — the one thing the header of a
        travel marketplace has to offer.
      */}
      <Link href="/account/trips" className={buttonStyles("ghost", "md", undefined, "dark")}>
        <span className="sm:hidden">Podróże</span>
        <span className="hidden sm:inline">Moje podróże</span>
      </Link>

      {isHost ? (
        <Link
          href="/host"
          className={buttonStyles("outline", "md", "hidden sm:inline-flex", "dark")}
        >
          Panel gospodarza
        </Link>
      ) : null}

      <Link href="/account" className={buttonStyles("ghost", "md", undefined, "dark")}>
        Konto
      </Link>

      <Button
        variant="ghost"
        size="md"
        tone="dark"
        aria-label="Wyloguj"
        disabled={leaving}
        onClick={logout}
      >
        <LogOut size={16} strokeWidth={2.3} />
      </Button>
    </>
  );
}
