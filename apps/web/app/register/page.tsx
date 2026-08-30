import type { Metadata } from "next";

import { AuthForm } from "@/components/account/AuthForm";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Rejestracja" };

export default async function RegisterPage({ searchParams }: PageProps) {
  const resolved = await searchParams;
  // Only relative paths, so `?returnTo=` cannot be used as an open redirect.
  const raw = typeof resolved.returnTo === "string" ? resolved.returnTo : "";
  const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account";

  return <AuthForm mode="register" returnTo={returnTo} />;
}
