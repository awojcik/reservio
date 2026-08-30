"use client";

import { AlertTriangle, Check, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError, type ExternalCalendar } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

const FIELD =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[14px] font-semibold text-ink placeholder:font-medium placeholder:text-muted/70";

const PROVIDERS = [
  { value: "AIRBNB", label: "Airbnb" },
  { value: "BOOKING", label: "Booking.com" },
  { value: "VRBO", label: "Vrbo" },
  { value: "PMS", label: "System PMS" },
  { value: "OTHER", label: "Inny" },
] as const;

const RELATIVE = new Intl.RelativeTimeFormat("pl-PL", { numeric: "auto" });

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, "hour");
  return RELATIVE.format(Math.round(hours / 24), "day");
}

export function ExternalCalendars({
  propertyId,
  onChanged,
}: {
  propertyId: string;
  onChanged: () => void;
}) {
  const { showToast } = useToast();

  const [calendars, setCalendars] = useState<ExternalCalendar[]>([]);
  const [provider, setProvider] = useState<string>("AIRBNB");
  const [name, setName] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCalendars(await apiClient.listExternalCalendars(propertyId));
    } catch {
      showToast("Nie udało się wczytać kalendarzy.");
    }
  }, [propertyId, showToast]);

  // State is set only after the request resolves, so the effect itself never
  // triggers a synchronous re-render.
  useEffect(() => {
    let cancelled = false;

    apiClient
      .listExternalCalendars(propertyId)
      .then((result) => {
        if (!cancelled) setCalendars(result);
      })
      .catch(() => {
        if (!cancelled) showToast("Nie udało się wczytać kalendarzy.");
      });

    return () => {
      cancelled = true;
    };
  }, [propertyId, showToast]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending("add");
    try {
      await apiClient.createExternalCalendar(propertyId, {
        provider: provider as "AIRBNB",
        name,
        importUrl,
      });
      setName("");
      setImportUrl("");
      showToast("Kalendarz dodany. Pierwsza synchronizacja trwa w tle.");
      await load();
      onChanged();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status === 400
          ? "Ten adres nie wygląda na poprawny publiczny feed iCal."
          : "Nie udało się dodać kalendarza.",
      );
    } finally {
      setPending(null);
    }
  }

  async function syncNow(calendar: ExternalCalendar) {
    setPending(calendar.id);
    try {
      await apiClient.syncExternalCalendar(propertyId, calendar.id);
      showToast("Synchronizacja zakolejkowana.");
      // The job runs in the background, so the fresh status arrives a moment
      // later; a short delay avoids showing the pre-sync state.
      setTimeout(() => {
        void load();
        onChanged();
      }, 2500);
    } catch {
      showToast("Nie udało się zakolejkować synchronizacji.");
    } finally {
      setPending(null);
    }
  }

  async function remove(calendar: ExternalCalendar) {
    setPending(calendar.id);
    try {
      await apiClient.deleteExternalCalendar(propertyId, calendar.id);
      showToast("Kalendarz odpięty, jego terminy zniknęły.");
      await load();
      onChanged();
    } catch {
      showToast("Nie udało się odpiąć kalendarza.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-[18px] font-bold tracking-tight">Kalendarze zewnętrzne</h3>
      <p className="mt-1.5 text-[13px] text-muted">
        Kalendarze iCal nie synchronizują się w czasie rzeczywistym — Rezervio odpytuje je
        okresowo, mniej więcej co 15 minut.
      </p>

      {calendars.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {calendars.map((calendar) => (
            <li key={calendar.id} className="rounded-[10px] border border-line px-3.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold">
                    {calendar.name}
                    <span className="ml-2 text-[12px] font-semibold text-muted">
                      {PROVIDERS.find((entry) => entry.value === calendar.provider)?.label ??
                        calendar.provider}
                    </span>
                    {calendar.status === "DISABLED" ? (
                      <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[11px] font-bold text-muted">
                        wyłączony
                      </span>
                    ) : null}
                  </p>
                  {/* Only ever the masked URL — the real one is a credential. */}
                  <p className="mt-0.5 truncate text-[12px] text-muted">{calendar.maskedUrl}</p>

                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-semibold">
                    {calendar.lastErrorCode ? (
                      <>
                        <AlertTriangle size={13} strokeWidth={2.6} className="text-accent-edge" />
                        Synchronizacja nie powiodła się
                        {calendar.consecutiveFailures > 1
                          ? ` (${calendar.consecutiveFailures} razy z rzędu)`
                          : ""}
                      </>
                    ) : calendar.lastSyncSucceededAt ? (
                      <>
                        <Check size={13} strokeWidth={3} className="text-success" />
                        Zsynchronizowano {relativeTime(calendar.lastSyncSucceededAt)}
                      </>
                    ) : (
                      <span className="text-muted">Jeszcze nie synchronizowano</span>
                    )}
                  </p>

                  <p className="mt-0.5 text-[12px] text-muted">
                    Zaimportowane terminy: {calendar.importedBlockCount}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => void syncNow(calendar)}
                  >
                    <RefreshCw size={14} strokeWidth={2.4} />
                    Synchronizuj
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Odepnij kalendarz"
                    disabled={pending !== null}
                    onClick={() => void remove(calendar)}
                  >
                    <Trash2 size={14} strokeWidth={2.4} />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={add} className="mt-4 space-y-3 border-t border-line pt-4">
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold">Serwis</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className={FIELD}
            >
              {PROVIDERS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[13px] font-bold">Nazwa</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              placeholder="Airbnb — apartament nad morzem"
              className={FIELD}
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[13px] font-bold">Adres feedu iCal</span>
          <input
            value={importUrl}
            onChange={(event) => setImportUrl(event.target.value)}
            required
            inputMode="url"
            placeholder="https://…/calendar.ics"
            className={FIELD}
          />
          <span className="mt-1 block text-[12px] text-muted">
            Adres bywa poufny — przechowujemy go zaszyfrowany i nigdy nie pokazujemy w całości.
          </span>
        </label>

        <Button type="submit" size="sm" disabled={pending === "add"}>
          <Link2 size={14} strokeWidth={2.4} />
          {pending === "add" ? "Dodaję…" : "Podepnij kalendarz"}
        </Button>
      </form>
    </div>
  );
}
