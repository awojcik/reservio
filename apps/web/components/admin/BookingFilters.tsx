"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES = [
  { value: "", label: "Wszystkie statusy" },
  { value: "PENDING_HOST_APPROVAL", label: "Czeka na gospodarza" },
  { value: "PENDING_PAYMENT", label: "Czeka na płatność" },
  { value: "CONFIRMED", label: "Potwierdzona" },
  { value: "COMPLETED", label: "Zakończona" },
  { value: "CANCELLED", label: "Anulowana" },
  { value: "EXPIRED", label: "Wygasła" },
];

/**
 * Filters as URL state.
 *
 * Both are sent to the API, never applied in the browser: `total` has to mean
 * "matching rows", not "matching rows among the ones we happened to fetch".
 */
export function BookingFilters({ search, status }: { search: string; status: string }) {
  const router = useRouter();
  const [term, setTerm] = useState(search);

  function apply(nextStatus = status, nextSearch = term) {
    const query = new URLSearchParams();
    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (nextStatus) query.set("status", nextStatus);
    router.push(`/admin/bookings${query.size ? `?${query.toString()}` : ""}`);
  }

  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Numer rezerwacji"
        aria-label="Numer rezerwacji"
        className="h-11 w-[240px] rounded-control border border-line bg-surface px-3 text-[15px] outline-none placeholder:text-placeholder focus:border-brand"
      />
      <select
        value={status}
        aria-label="Status rezerwacji"
        onChange={(event) => apply(event.target.value)}
        className="h-11 rounded-control border border-line bg-surface px-3 text-[15px] outline-none focus:border-brand"
      >
        {STATUSES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="h-11 rounded-control border border-brand bg-brand px-5 text-[15px] font-bold text-surface"
      >
        Filtruj
      </button>
    </form>
  );
}
