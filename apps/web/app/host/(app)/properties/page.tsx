import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PropertyActions } from "@/components/host/PropertyActions";
import { StatusBadge } from "@/components/host/StatusBadge";
import { ImageWithFallback } from "@/components/ui/ImageWithFallback";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import { formatAmountMinor } from "@/lib/format";

export const metadata: Metadata = { title: "Twoje obiekty" };

const UPDATED_AT = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function HostPropertiesPage() {
  const client = await createSessionApiClient();
  const properties = await client.listHostProperties({ cache: "no-store" });

  return (
    <div className="py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Obiekty</p>
          <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
            Twoje obiekty
          </h1>
        </div>
        <Link href="/host/properties/new" className={buttonStyles("accent", "md")}>
          <Plus size={17} strokeWidth={2.6} />
          Dodaj obiekt
        </Link>
      </div>

      {properties.length === 0 ? (
        <p className="mt-8 rounded-[14px] border border-dashed border-line bg-surface/60 px-5 py-10 text-center text-[15px] text-muted">
          Nie masz jeszcze żadnego obiektu.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {properties.map((property) => (
            <li
              key={property.id}
              className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-3 sm:flex-row sm:items-center sm:p-4"
            >
              <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-[10px] bg-placeholder sm:w-[132px]">
                {property.coverImage ? (
                  <ImageWithFallback
                    src={property.coverImage.url}
                    alt={property.coverImage.altText ?? property.title}
                    fill
                    sizes="132px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-[12px] font-bold text-muted">
                    Brak zdjęć
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={property.status} />
                  {!property.publishReadiness.ready ? (
                    <span className="text-[12px] font-bold text-muted">
                      brakuje {property.publishReadiness.missing.length} elementów
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-1.5 truncate text-[18px] font-bold tracking-tight">
                  {property.title}
                </h2>

                <p className="mt-1 text-[14px] text-muted">
                  {property.city || "Bez lokalizacji"} ·{" "}
                  <span className="font-semibold text-ink">
                    {formatAmountMinor(property.pricing.baseDailyRateAmountMinor)}
                  </span>{" "}
                  za noc · zmieniony {UPDATED_AT.format(new Date(property.updatedAt))}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/host/properties/${property.id}`}
                    className={buttonStyles("primary", "sm")}
                  >
                    Edytuj
                  </Link>
                  <Link
                    href={`/host/properties/${property.id}/calendar`}
                    className={buttonStyles("outline", "sm")}
                  >
                    Kalendarz
                  </Link>
                  <Link
                    href={`/host/properties/${property.id}/preview`}
                    className={buttonStyles("outline", "sm")}
                  >
                    Podgląd
                  </Link>
                  <PropertyActions propertyId={property.id} status={property.status} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
