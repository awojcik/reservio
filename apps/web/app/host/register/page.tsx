import type { Metadata } from "next";

import { AuthForm } from "@/components/account/AuthForm";

export const metadata: Metadata = { title: "Rejestracja gospodarza" };

export default function HostRegisterPage() {
  return <AuthForm mode="host-register" returnTo="/host" />;
}
