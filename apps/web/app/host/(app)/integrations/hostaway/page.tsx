import type { Metadata } from "next";
import Link from "next/link";

import { ConnectHostawayForm } from "@/components/host/ConnectHostawayForm";

export const metadata: Metadata = { title: "Połącz Hostaway" };

export default function ConnectHostawayPage() {
  return (
    <div className="py-8 sm:py-10">
      <Link
        href="/host/integrations"
        className="text-[14px] font-bold text-brand underline underline-offset-4"
      >
        ← Integracje
      </Link>

      <p className="eyebrow mt-4">Hostaway</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Połącz Hostaway
      </h1>
      <p className="mt-3 max-w-[62ch] text-[16px] text-muted">
        Rezervio pobierze z Hostaway rezerwacje dla obiektów, które sam wskażesz, i będzie
        mu przekazywać rezerwacje zrobione tutaj. Zdjęcia, opisy, ceny i wiadomości
        pozostają poza zakresem.
      </p>

      <div className="mt-8">
        <ConnectHostawayForm />
      </div>
    </div>
  );
}
