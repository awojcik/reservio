"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type Profile } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

const FIELD =
  "h-12 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] font-semibold text-ink placeholder:font-medium placeholder:text-muted/70";

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [firstName, setFirstName] = useState(initial.firstName ?? "");
  const [lastName, setLastName] = useState(initial.lastName ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [locale, setLocale] = useState(initial.preferredLocale ?? "pl");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    try {
      await apiClient.updateProfile({
        firstName,
        lastName,
        phone,
        preferredLocale: locale as "pl",
      });
      showToast("Profil zapisany.");
      router.refresh();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status === 400
          ? "Sprawdź poprawność danych."
          : "Nie udało się zapisać profilu.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 max-w-[520px] space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-bold">Imię</span>
          <input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoComplete="given-name"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[14px] font-bold">Nazwisko</span>
          <input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            autoComplete="family-name"
            className={FIELD}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-[14px] font-bold">Email</span>
        <input value={initial.email} readOnly disabled className={`${FIELD} opacity-60`} />
        {/* Email is the login identity; changing it needs a verification flow. */}
        <span className="mt-1.5 block text-[13px] text-muted">
          Adresu email używasz do logowania — na razie nie da się go tu zmienić.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[14px] font-bold">Telefon</span>
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          type="tel"
          autoComplete="tel"
          placeholder="+48 600 100 200"
          className={FIELD}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[14px] font-bold">Język</span>
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
          className={FIELD}
        >
          <option value="pl">polski</option>
          <option value="en">English</option>
        </select>
      </label>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Zapisuję…" : "Zapisz profil"}
      </Button>

      <p className="text-[13px] text-muted">
        Zmiana profilu nie zmienia danych zapisanych przy Twoich dotychczasowych
        rezerwacjach.
      </p>
    </form>
  );
}
