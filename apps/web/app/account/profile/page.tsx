import { ArrowLeft, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProfileForm } from "@/components/account/ProfileForm";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const client = await createSessionApiClient();
  const profile = await client.getProfile({ cache: "no-store" });

  return (
    <div className="py-8 sm:py-10">
      <Link
        href="/account"
        className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft size={16} strokeWidth={2.4} />
        Wróć do konta
      </Link>

      <p className="eyebrow mt-3">Profil</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Twoje dane
      </h1>

      {profile.isHost ? (
        <p className="mt-3 text-[15px] text-muted">
          To konto ma też profil gospodarza.{" "}
          <Link href="/host" className="font-bold text-brand underline underline-offset-2">
            Przejdź do panelu
          </Link>
          .
        </p>
      ) : null}

      <ProfileForm initial={profile} />

      {profile.isHost ? (
        <div className="mt-8">
          <Link href="/host" className={buttonStyles("outline", "md")}>
            <LayoutDashboard size={16} strokeWidth={2.3} />
            Panel gospodarza
          </Link>
        </div>
      ) : null}
    </div>
  );
}
