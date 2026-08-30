import type { Metadata } from "next";

import { CreatePropertyForm } from "@/components/host/CreatePropertyForm";

export const metadata: Metadata = { title: "Nowy obiekt" };

export default function NewHostPropertyPage() {
  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Nowy obiekt</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Zacznijmy od podstaw
      </h1>
      <p className="mt-3 max-w-[52ch] text-[16px] text-muted">
        Utworzymy szkic, który możesz uzupełniać stopniowo. Obiekt trafi do wyszukiwarki
        dopiero, gdy sam go opublikujesz.
      </p>

      <CreatePropertyForm />
    </div>
  );
}
