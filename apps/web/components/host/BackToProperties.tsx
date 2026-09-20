"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/**
 * The way out of the Property editor.
 *
 * Create and edit are the two screens a Host can reach with no route back:
 * the panel header goes to the dashboard, and nothing pointed at the list
 * they came from. A second full navigation bar would be the wrong answer —
 * this is one contextual link, under the header, on both screens.
 *
 * When there is unsaved work it asks first. Two mechanisms, because they
 * cover two different exits: `beforeunload` for closing the tab or reloading,
 * and the click handler for an in-app navigation, which never reaches
 * `beforeunload` at all.
 */
export function BackToProperties({ dirty = false }: { dirty?: boolean }) {
  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <Link
      href="/host/properties"
      onClick={(event) => {
        if (!dirty) return;
        const leave = window.confirm(
          "Masz niezapisane zmiany. Opuścić edytor bez zapisywania?",
        );
        if (!leave) event.preventDefault();
      }}
      className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
    >
      <ArrowLeft size={16} strokeWidth={2.4} />
      Wróć do obiektów
    </Link>
  );
}
