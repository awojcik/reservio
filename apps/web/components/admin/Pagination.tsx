"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/Button";

/**
 * Server-side paging, driven from the URL.
 *
 * The page number is a query parameter rather than component state so a
 * particular page can be linked to, and so a refresh after an action lands
 * where the operator was (milestone 11 §36).
 */
export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  function goTo(next: number) {
    const query = new URLSearchParams(params.toString());
    query.set("page", String(next));
    router.push(`?${query.toString()}`);
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-[14px] text-muted">
        Strona {page} z {lastPage} · {total} pozycji
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          Poprzednia
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => goTo(page + 1)}
        >
          Następna
        </Button>
      </div>
    </div>
  );
}
