import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { BookingsTable } from "@/components/admin/BookingsTable";
import { Field, Section } from "@/components/admin/Section";
import { formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Użytkownik — admin" };

/**
 * One account.
 *
 * There is no password hash here and no session token — not even a truncated
 * one. What support needs is "does this person have a live session", and that
 * is a count (milestone 11 §8).
 */
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let user;
  try {
    user = await client.getAdminUser(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  return (
    <div className="py-8">
      <p className="eyebrow">Użytkownik</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        {fullName || user.email}
      </h1>

      <Section title="Konto">
        <dl className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Email">{user.email}</Field>
          <Field label="Identyfikator">
            <code className="text-[13px]">{user.id}</code>
          </Field>
          <Field label="Konto od">{formatInstant(user.createdAt)}</Field>
          <Field label="Role">
            {user.roles.length > 0 ? user.roles.join(", ") : "zwykłe konto"}
          </Field>
          <Field label="Profil gospodarza">
            {user.hostId ? (
              <Link
                href={`/admin/hosts/${user.hostId}`}
                className="font-bold text-brand underline underline-offset-2"
              >
                {user.hostDisplayName}
              </Link>
            ) : (
              "brak"
            )}
          </Field>
          <Field label="Sesje">
            {user.sessions.active} aktywnych
            <span className="block text-[13px] text-muted">
              ostatnio {formatInstant(user.sessions.lastSeenAt)} · wygasa{" "}
              {formatInstant(user.sessions.expiresAt)}
            </span>
          </Field>
        </dl>
      </Section>

      <Section
        title="Rezerwacje tego konta"
        description="Czytane po guest_user_id, nigdy po adresie email — powiązanie wymaga jawnego claimu."
      >
        <div className="p-4">
          <BookingsTable rows={user.bookings} />
        </div>
      </Section>
    </div>
  );
}
