"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * The one box support types into.
 *
 * The term goes into the URL so a result page can be linked to a colleague,
 * and the API is what decides which of nine tables it belongs to
 * (milestone 11 §6).
 */
export function AdminSearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get("q") ?? "");

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = term.trim();
        if (trimmed.length >= 2) router.push(`/admin/search?q=${encodeURIComponent(trimmed)}`);
      }}
    >
      <label className="sr-only" htmlFor="admin-search">
        Szukaj
      </label>
      <div className="relative flex-1">
        <Search
          size={17}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
        />
        <input
          id="admin-search"
          name="q"
          value={term}
          autoFocus={autoFocus}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Numer rezerwacji, email, nazwa obiektu, pi_… / re_… / tr_… / po_…"
          className="h-11 w-full rounded-control border border-line bg-surface pr-3 pl-9 text-[15px] outline-none placeholder:text-placeholder focus:border-brand"
        />
      </div>
      <button
        type="submit"
        className="h-11 rounded-control border border-brand bg-brand px-5 text-[15px] font-bold text-surface"
      >
        Szukaj
      </button>
    </form>
  );
}
