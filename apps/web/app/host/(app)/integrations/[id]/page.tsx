import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { PropertyMappingPanel } from "@/components/host/PropertyMappingPanel";
import { createSessionApiClient } from "@/lib/api-server";
import { PROVIDER_LABELS } from "@/lib/integrations";

export const metadata: Metadata = { title: "Mapowanie obiektów" };

/**
 * Mapping for one connection.
 *
 * Listings are fetched from the provider on demand rather than cached: a Host
 * who just added a listing expects to see it, and a stale list would have them
 * mapping something that no longer exists.
 */
export default async function IntegrationMappingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await createSessionApiClient();

  const integrations = await client.getHostIntegrations({ cache: "no-store" });
  const integration = integrations.items.find((item) => item.id === id);
  if (!integration) notFound();

  let listings;
  try {
    listings = await client.listIntegrationProperties(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const properties = await client.listHostProperties({ cache: "no-store" });

  return (
    <div className="py-8 sm:py-10">
      <Link
        href="/host/integrations"
        className="text-[14px] font-bold text-brand underline underline-offset-4"
      >
        ← Integracje
      </Link>

      <p className="eyebrow mt-4">
        {PROVIDER_LABELS[integration.provider] ?? integration.provider}
      </p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Mapowanie obiektów
      </h1>
      <p className="mt-3 max-w-[62ch] text-[16px] text-muted">
        Jeden obiekt Rezervio odpowiada jednemu listingowi u dostawcy. Dopóki obiekt nie
        jest zmapowany, nic się z nim nie synchronizuje.
      </p>

      <div className="mt-8">
        <PropertyMappingPanel
          connectionId={id}
          listings={listings}
          properties={properties.map((property) => ({
            id: property.id,
            title: property.title,
          }))}
        />
      </div>
    </div>
  );
}
