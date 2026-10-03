"use client";

import Link from "next/link";

import { AccountNav } from "@/components/account/AccountNav";
import { buttonStyles } from "@/components/ui/Button";
import { Logo } from "./Logo";
import { cn } from "@/lib/cn";

export type HeaderIdentity = { isHost: boolean } | null;

/**
 * The header itself, with no data fetching of its own.
 *
 * Kept presentational so a Client Component can render it too — `Header`
 * loads the identity on the server and passes it in.
 */
export function HeaderShell({
  className,
  identity,
}: {
  className?: string;
  identity: HeaderIdentity;
}) {
  return (
    <header
      className={cn(
        // Deep pine on every screen: the brand travels with the guest, and on
        // the homepage it merges into the hero as one surface.
        "sticky top-0 z-40 h-[72px] border-b border-surface/15 bg-brand",
        className,
      )}
    >
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <Logo size={23} onDark />

        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Główna">
          {identity ? (
            <AccountNav isHost={identity.isHost} />
          ) : (
            <>
              <Link
                href="/host/register"
                className={buttonStyles("outline", "md", "hidden sm:inline-flex", "dark")}
              >
                Dla gospodarzy
              </Link>

              <Link href="/login" className={buttonStyles("ghost", "md", undefined, "dark")}>
                Zaloguj się
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
