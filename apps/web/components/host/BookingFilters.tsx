"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { HostPropertySummary } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Filters live in the URL, so a filtered list is shareable and the back button
 * behaves. Every change resets the offset — page 3 of the old query says
 * nothing about the new one.
 */
const STATUSES = [
  { value: "", label: "Wszystkie" },
  { value: "PENDING_HOST_APPROVAL", label: "Do decyzji" },
  { value: "CONFIRMED", label: "Potwierdzone" },
  { value: "PENDING_PAYMENT", label: "Czeka na płatność" },
  { value: "CANCELLED", label: "Anulowane" },
  { value: "EXPIRED", label: "Wygasłe" },
];

const SORTS = [
  { value: "NEWEST", label: "Najnowsze" },
  { value: "ACTION_REQUIRED", label: "Wymagają decyzji" },
  { value: "STAY_DATE_ASC", label: "Pobyt: najbliższe" },
  { value: "STAY_DATE_DESC", label: "Pobyt: najdalsze" },
];

export function BookingFilters({
  properties,
}: {
  properties: HostPropertySummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const applied = params.get("search") ?? "";
  const [search, setSearch] = useState(applied);
  const [lastApplied, setLastApplied] = useState(applied);

  // A filter change elsewhere (or the back button) must not leave a stale
  // query in the box. Adjusted during render rather than in an effect, so
  // there is no second pass with the old value on screen.
  if (applied !== lastApplied) {
    setLastApplied(applied);
    setSearch(applied);
  }

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("offset");
    router.push(`${pathname}?${next.toString()}`);
  }

  const status = params.get("status") ?? "";
  const propertyId = params.get("propertyId") ?? "";
  const sort = params.get("sort") ?? "NEWEST";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const filtered = Boolean(status || propertyId || from || to || params.get("search"));

  return (
    <div className="mt-5 space-y-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ search });
        }}
        className="flex flex-wrap gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            strokeWidth={2.4}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Numer rezerwacji, imię lub email gościa"
            aria-label="Szukaj rezerwacji"
            className="h-10 w-full rounded-[10px] border border-line bg-surface pr-3 pl-9 text-[14px] font-semibold placeholder:font-normal placeholder:text-muted"
          />
        </div>
        <Button type="submit" size="md" variant="outline">
          Szukaj
        </Button>
      </form>

      <nav className="flex flex-wrap gap-2" aria-label="Filtr statusu">
        {STATUSES.map((option) => (
          <button
            key={option.value || "all"}
            type="button"
            onClick={() => apply({ status: option.value })}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-bold transition-colors",
              status === option.value
                ? "border-accent bg-accent/12 text-ink"
                : "border-line bg-surface text-ink hover:border-ink/35",
            )}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Obiekt">
          <select
            value={propertyId}
            onChange={(event) => apply({ propertyId: event.target.value })}
            className="h-9 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] font-semibold"
          >
            <option value="">Wszystkie</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Pobyt od">
          <input
            type="date"
            value={from}
            onChange={(event) => apply({ from: event.target.value })}
            className="h-9 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] font-semibold"
          />
        </Field>

        <Field label="Pobyt do">
          <input
            type="date"
            value={to}
            onChange={(event) => apply({ to: event.target.value })}
            className="h-9 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] font-semibold"
          />
        </Field>

        <Field label="Sortowanie">
          <select
            value={sort}
            onChange={(event) => apply({ sort: event.target.value })}
            className="h-9 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] font-semibold"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {filtered ? (
          <Button size="sm" variant="ghost" onClick={() => router.push(pathname)}>
            <X size={15} strokeWidth={2.5} />
            Wyczyść
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}
