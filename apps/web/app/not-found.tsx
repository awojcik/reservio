import Link from "next/link";

import { Logo } from "@/components/layout/Logo";
import { buttonStyles } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center px-6 py-20">
      <Logo size={24} asLink={false} />
      <h1 className="mt-8 text-[36px] leading-tight font-bold tracking-tightest">
        Nie ma tu żadnego miejsca.
      </h1>
      <p className="mt-3 text-[16px] text-muted">
        Ten obiekt zniknął z oferty albo adres jest nieprawidłowy. Wyszukiwarka działa
        normalnie.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/search" className={buttonStyles("primary", "md")}>
          Wróć do wyników
        </Link>
        <Link href="/" className={buttonStyles("outline", "md")}>
          Strona główna
        </Link>
      </div>
    </main>
  );
}
