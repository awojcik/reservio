import { Header } from "@/components/layout/Header";
import { requireUser } from "@/lib/session";

/**
 * The account area is for the signed-in visitor. It reuses the public header
 * rather than a separate shell — this is a travel marketplace, not a
 * dashboard product (milestone 06 §39).
 */
export default async function AccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser("/account");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">{children}</main>
    </>
  );
}
