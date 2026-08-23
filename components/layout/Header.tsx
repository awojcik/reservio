"use client";

import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Logo } from "./Logo";
import { cn } from "@/lib/cn";

export function Header({ className }: { className?: string }) {
  const { showToast } = useToast();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-[72px] border-b border-line bg-surface",
        className,
      )}
    >
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <Logo size={23} />

        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Główna">
          <Button
            variant="outline"
            size="md"
            className="hidden sm:inline-flex"
            onClick={() =>
              showToast("Panel gospodarza pojawi się w kolejnym etapie MVP.")
            }
          >
            Dla gospodarzy
          </Button>

          <Button
            variant="ghost"
            size="md"
            onClick={() => showToast("Logowanie pojawi się w kolejnym etapie MVP.")}
          >
            Zaloguj się
          </Button>
        </nav>
      </div>
    </header>
  );
}
