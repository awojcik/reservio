import type { Metadata } from "next";
import Link from "next/link";

import { AdminSearchBox } from "@/components/admin/AdminSearchBox";
import { SEARCH_KIND_LABELS } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Szukaj — admin" };

/**
 * One box, every identifier support might be handed.
 *
 * The term lives in the URL, so a result can be pasted to a colleague. Which
 * of nine tables it belongs to is the API's problem, not the operator's
 * (milestone 11 §6).
 */
export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const results =
    term.length >= 2
      ? await (await createSessionApiClient()).adminSearch(
          { q: term, limit: 30 },
          { cache: "no-store" },
        )
      : null;

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Wyszukiwanie globalne
      </h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Numer rezerwacji, adres email gościa lub gospodarza, nazwa albo identyfikator obiektu,
        a także identyfikator płatności, zwrotu, rozliczenia, przelewu i wypłaty — własny
        albo nadany przez dostawcę.
      </p>

      <div className="mt-6 max-w-[720px]">
        <AdminSearchBox autoFocus />
      </div>

      {results === null ? (
        <p className="mt-8 text-[15px] text-muted">Wpisz co najmniej dwa znaki.</p>
      ) : results.items.length === 0 ? (
        <p className="mt-8 rounded-card border border-line bg-surface px-4 py-8 text-center text-[15px] text-muted">
          Nic nie pasuje do „{results.query}”.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-line/60 rounded-card border border-line bg-surface">
          {results.items.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <Link
                href={hit.href}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-background"
              >
                <span className="inline-flex h-7 min-w-[104px] items-center justify-center rounded-full border border-line bg-background px-2.5 text-[12px] font-bold">
                  {SEARCH_KIND_LABELS[hit.kind] ?? hit.kind}
                </span>
                <span className="text-[15px] font-bold">{hit.label}</span>
                <span className="text-[14px] text-muted">{hit.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
