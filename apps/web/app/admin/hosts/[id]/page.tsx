import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { IssueList } from "@/components/admin/IssueList";
import { RefreshConnectButton } from "@/components/admin/RefreshConnectButton";
import { Field, Section } from "@/components/admin/Section";
import { StatePill } from "@/components/admin/StatusPill";
import { formatInstant, formatMinor } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Gospodarz — admin" };

/**
 * One Host and their money.
 *
 * Connect readiness, settlements, transfers and payouts — the four different
 * things a "why have I not been paid" question can actually be about. Rezervio
 * stores no KYC documents and no bank numbers, so none appear here
 * (milestone 11 §8).
 */
export default async function AdminHostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let host;
  try {
    host = await client.getAdminHost(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="py-8">
      <p className="eyebrow">Gospodarz</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        {host.displayName}
      </h1>

      <Section
        title="Konto rozliczeniowe"
        description="Onboarding prowadzi dostawca na własnych stronach. Sandbox — realne wypłaty się nie dzieją."
        action={<RefreshConnectButton hostId={host.id} />}
      >
        <dl className="grid gap-4 p-4 sm:grid-cols-4">
          <Field label="Gotowość">
            <StatePill status={host.connectReadiness} />
          </Field>
          <Field label="Może przyjmować płatności">{host.chargesEnabled ? "tak" : "nie"}</Field>
          <Field label="Może otrzymywać wypłaty">{host.payoutsEnabled ? "tak" : "nie"}</Field>
          <Field label="Konto u dostawcy">
            <code className="text-[13px]">{host.providerAccountId ?? "—"}</code>
          </Field>
          <Field label="Konto użytkownika">
            {host.userId ? (
              <Link
                href={`/admin/users/${host.userId}`}
                className="font-bold text-brand underline underline-offset-2"
              >
                {host.email ?? host.userId}
              </Link>
            ) : (
              "konto bez logowania"
            )}
          </Field>
        </dl>
      </Section>

      {host.issues.length > 0 ? (
        <Section title="Problemy operacyjne tego gospodarza">
          <div className="p-4">
            <IssueList issues={host.issues} />
          </div>
        </Section>
      ) : null}

      <Section title="Obiekty">
        {host.properties.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">Brak obiektów.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {host.properties.map((property) => (
              <li key={property.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={property.status} />
                <Link
                  href={`/admin/properties/${property.id}`}
                  className="text-[15px] font-bold text-brand underline underline-offset-2"
                >
                  {property.title}
                </Link>
                <span className="text-[14px] text-muted">{property.city}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Rozliczenia"
        description="Saldo nie jest przechowywane — jest liczone z rozliczeń przy każdym odczycie."
      >
        {host.settlements.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">Brak rozliczeń.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {host.settlements.map((settlement) => (
              <li key={settlement.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={settlement.status} />
                <span className="text-[14px] font-bold">
                  {formatMinor(settlement.hostAmountMinor, settlement.currency)}
                </span>
                <span className="text-[14px] text-muted">
                  z {formatMinor(settlement.grossAmountMinor, settlement.currency)} brutto
                </span>
                <span className="ml-auto text-[13px] text-muted">
                  zwolnienie {formatInstant(settlement.releaseAt)}
                  {settlement.failureCode ? ` · ${settlement.failureCode}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Wypłaty"
        description="Wykonuje je dostawca według harmonogramu konta. Rezervio je obserwuje, nie inicjuje."
      >
        {host.payouts.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Nie zaobserwowano jeszcze żadnej wypłaty.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {host.payouts.map((payout) => (
              <li key={payout.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatePill status={payout.status} />
                <span className="text-[14px] font-bold">
                  {formatMinor(payout.amountMinor, payout.currency)}
                </span>
                <span className="ml-auto text-[13px] text-muted">
                  {payout.arrivalAt ? formatInstant(payout.arrivalAt) : "—"}
                  {payout.failureCode ? ` · ${payout.failureCode}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
