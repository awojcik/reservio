"use client";

import { ChevronDown } from "lucide-react";

import { formatDestinationPhrase, formatResultCount } from "@/lib/format";
import { SORT_OPTIONS } from "@/lib/search";
import type { SortOption } from "@/lib/types";

type ResultsHeaderProps = {
  count: number;
  destination: string;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
};

export function ResultsHeader({
  count,
  destination,
  sort,
  onSortChange,
}: ResultsHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <h1 className="text-[24px] leading-tight font-bold tracking-tight" aria-live="polite">
        {formatResultCount(count)}
        {destination ? (
          <span className="text-muted"> {formatDestinationPhrase(destination)}</span>
        ) : null}
      </h1>

      <label className="flex items-center gap-2 text-[14px] font-semibold text-muted">
        Sortuj:
        <span className="relative">
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SortOption)}
            className="h-11 appearance-none rounded-[9px] border border-line bg-surface pr-8 pl-3 text-[14px] font-bold text-ink"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            strokeWidth={2.5}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"
          />
        </span>
      </label>
    </div>
  );
}
