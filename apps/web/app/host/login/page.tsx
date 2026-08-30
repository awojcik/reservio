import type { Metadata } from "next";

import { AuthForm } from "@/components/account/AuthForm";

export const metadata: Metadata = { title: "Logowanie gospodarza" };

export default function HostLoginPage() {
  return <AuthForm mode="login" returnTo="/host" />;
}
