"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type ExternalListings } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

export type MappableProperty = { id: string; title: string };

/**
 * Mapping listings to Properties.
 *
 * The suggestion is offered and the Host confirms — always. Auto-mapping on a
 * name would quietly start blocking the wrong calendar, and the first person
 * to notice would be a Guest standing outside an occupied flat
 * (milestone 12 §11, §23).
 */
export function PropertyMappingPanel({
  connectionId,
  listings,
  properties,
}: {
  connectionId: string;
  listings: ExternalListings;
  properties: MappableProperty[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      listings.items.map((listing) => [listing.externalId, listing.suggestedPropertyId ?? ""]),
    ),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function confirm(externalId: string, name: string) {
    const propertyId = choices[externalId];
    if (!propertyId) return;

    setBusy(externalId);
    try {
      await apiClient.createIntegrationMapping(connectionId, {
        propertyId,
        externalPropertyId: externalId,
        externalPropertyName: name,
      });
      showToast("Zmapowano. Synchronizacja tego obiektu trafiła do kolejki.");
      router.refresh();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { message?: string }) : undefined;
      showToast(body?.message ?? "Nie udało się zmapować obiektu.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(mappingId: string) {
    setBusy(mappingId);
    try {
      await apiClient.deleteIntegrationMapping(connectionId, mappingId);
      showToast("Mapowanie usunięte. Istniejące blokady zostały zachowane.");
      router.refresh();
    } catch {
      showToast("Nie udało się usunąć mapowania.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[18px] font-bold tracking-tightest">Zmapowane obiekty</h2>
        <div className="mt-3 rounded-card border border-line bg-surface">
          {listings.mappings.length === 0 ? (
            <p className="px-4 py-8 text-center text-[15px] text-muted">
              Nic jeszcze nie jest zmapowane.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {listings.mappings.map((mapping) => (
                <li key={mapping.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="text-[15px] font-bold">{mapping.propertyTitle}</span>
                  <span className="text-[14px] text-muted">
                    ↔ {mapping.externalPropertyName ?? mapping.externalPropertyId}
                  </span>
                  <span className="text-[13px] text-muted">
                    {mapping.activeReservations} aktywnych rezerwacji z tego źródła
                  </span>
                  <Button
                    className="ml-auto"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => remove(mapping.id)}
                  >
                    Usuń mapowanie
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-[18px] font-bold tracking-tightest">Listingi u dostawcy</h2>
        <p className="mt-1 max-w-[62ch] text-[14px] text-muted">
          Propozycja pojawia się tylko przy dokładnie zgodnej nazwie i zawsze wymaga
          potwierdzenia. Błędne mapowanie zablokowałoby kalendarz nie tego obiektu.
        </p>

        <div className="mt-3 rounded-card border border-line bg-surface">
          {listings.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[15px] text-muted">
              Dostawca nie zwrócił żadnych listingów.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {listings.items.map((listing) => (
                <li
                  key={listing.externalId}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold">{listing.name}</p>
                    <p className="text-[13px] text-muted">
                      {listing.address ?? "—"} · id {listing.externalId}
                    </p>
                  </div>

                  {listing.mapped ? (
                    <span className="ml-auto text-[14px] font-bold text-success">
                      Zmapowany
                    </span>
                  ) : (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`map-${listing.externalId}`}>
                        Obiekt Rezervio dla {listing.name}
                      </label>
                      <select
                        id={`map-${listing.externalId}`}
                        value={choices[listing.externalId] ?? ""}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [listing.externalId]: event.target.value,
                          }))
                        }
                        className="h-9 rounded-control border border-line bg-surface px-2 text-[14px] outline-none focus:border-brand"
                      >
                        <option value="">Wybierz obiekt…</option>
                        {properties.map((property) => (
                          <option key={property.id} value={property.id}>
                            {property.title}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || !choices[listing.externalId]}
                        onClick={() => confirm(listing.externalId, listing.name)}
                      >
                        Potwierdź
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
