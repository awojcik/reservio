import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchExperience } from "@/components/search/SearchExperience";

export const metadata: Metadata = {
  title: "Wyniki wyszukiwania",
};

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchExperience />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div className="min-h-dvh">
      <div className="h-[72px] border-b border-line bg-surface" />
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <div className="h-[68px] rounded-[16px] border border-line bg-surface" />
        <p className="mt-6 text-[15px] text-muted">Wczytujemy oferty…</p>
      </div>
    </div>
  );
}
