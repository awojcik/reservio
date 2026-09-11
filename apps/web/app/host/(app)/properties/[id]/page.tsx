import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { PropertyEditor } from "@/components/host/PropertyEditor";
import { StayInformationEditor } from "@/components/host/StayInformationEditor";
import { createSessionApiClient } from "@/lib/api-server";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Edycja obiektu" };

export default async function HostPropertyEditorPage({ params }: PageProps) {
  const { id } = await params;
  const client = await createSessionApiClient();

  // Only the fetch is guarded: rendering must stay outside the try, because a
  // render-time error would not be caught here anyway.
  let property;
  let amenities;
  let stayInformation;
  let sensitiveAccess;
  try {
    [property, amenities, stayInformation, sensitiveAccess] = await Promise.all([
      client.getHostProperty(id, { cache: "no-store" }),
      client.listAmenities({ cache: "no-store" }),
      client.getHostStayInformation(id, { cache: "no-store" }),
      client.getHostSensitiveAccess(id, { cache: "no-store" }),
    ]);
  } catch (error) {
    // A Property owned by somebody else answers 404 — the Host area shows the
    // same "not found" as a Property that truly does not exist.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <PropertyEditor
        initial={property}
        amenityCodes={amenities.map((amenity) => amenity.code)}
      />
      <StayInformationEditor
        propertyId={property.id}
        timeZone={stayInformation.timeZone}
        initialStay={stayInformation}
        initialAccess={sensitiveAccess}
      />
    </>
  );
}
