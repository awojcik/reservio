import { Eye } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { StatusBadge } from "@/components/host/StatusBadge";
import { PropertyDetailView } from "@/components/property/PropertyDetailView";
import { createSessionApiClient } from "@/lib/api-server";
import { toPreviewDetail } from "@/lib/host-preview";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Podgląd obiektu" };

/** Works for DRAFT, SUSPENDED and PUBLISHED — ownership is enforced by the API. */
export default async function HostPropertyPreviewPage({ params }: PageProps) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let property;
  try {
    property = await client.getHostProperty(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return (
    <div className="pb-16">
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3">
        <Eye size={18} strokeWidth={2.3} className="text-brand" />
        <p className="text-[14px] font-bold">Podgląd gospodarza</p>
        <StatusBadge status={property.status} />
        <p className="text-[13px] text-muted">
          Tak zobaczy tę stronę gość. Ocena i opinie pojawią się po pierwszych pobytach.
        </p>
      </div>

      <PropertyDetailView
        property={toPreviewDetail(property)}
        checkIn={today.toISOString().slice(0, 10)}
        checkOut={tomorrow.toISOString().slice(0, 10)}
        adults={2}
        childrenCount={0}
        backHref={`/host/properties/${property.id}`}
        backLabel="Wróć do edycji"
      />
    </div>
  );
}
