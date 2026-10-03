import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@rezervio/api-client";

import { CalendarWorkspace } from "@/components/host/CalendarWorkspace";
import { StatusBadge } from "@/components/host/StatusBadge";
import { createSessionApiClient } from "@/lib/api-server";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Kalendarz obiektu" };

export default async function HostPropertyCalendarPage({ params }: PageProps) {
  const { id } = await params;
  const client = await createSessionApiClient();

  let property;
  try {
    property = await client.getHostProperty(id, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="py-8 sm:py-10">
      <Link
        href={`/host/properties/${property.id}`}
        className="inline-flex items-center gap-1.5 text-[14px] font-bold text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft size={16} strokeWidth={2.4} />
        Wróć do edycji
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={property.status} />
        <span className="text-[13px] text-muted">/{property.slug}</span>
      </div>

      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Kalendarz — {property.title}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[16px] text-muted">
        Zablokowane terminy znikają z wyszukiwarki. Blokady możesz dodawać ręcznie albo
        importować z innych serwisów.
      </p>

      <CalendarWorkspace propertyId={property.id} />
    </div>
  );
}
