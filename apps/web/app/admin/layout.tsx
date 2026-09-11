import type { Metadata } from "next";
import Link from "next/link";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { requireAdmin } from "@/lib/admin-session";

export const metadata: Metadata = { title: "Rezervio — panel administracyjny" };

/**
 * The admin area.
 *
 * The guard runs here, but it is not the protection: every `/api/admin/*`
 * route is guarded server-side by role, so a Host who types the URL is refused
 * by the API whatever this layout renders. What this adds is a clear answer
 * instead of a page full of failed requests (milestone 11 §4, §56).
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await requireAdmin();

  if (!access.allowed) {
    return (
      <main className="mx-auto max-w-[560px] px-4 py-24 text-center">
        <p className="eyebrow">403</p>
        <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-tightest">
          Brak uprawnień
        </h1>
        <p className="mt-3 text-[16px] text-muted">
          To konto nie ma roli administracyjnej. Panel wsparcia jest dostępny wyłącznie
          dla kont z rolą SUPPORT lub ADMIN.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex text-[15px] font-bold text-brand underline underline-offset-4"
        >
          Wróć na stronę główną
        </Link>
      </main>
    );
  }

  return (
    <>
      <AdminHeader stripe={access.stripe} />
      <main className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-6">{children}</main>
    </>
  );
}
