"use client";

import { Copy, Download, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CalendarExportStatus } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * The export URL is shown once, right after it is minted. Afterwards only its
 * existence is known — the backend keeps a hash, exactly like a session token.
 */
export function CalendarExport({ propertyId }: { propertyId: string }) {
  const { showToast } = useToast();

  const [status, setStatus] = useState<CalendarExportStatus | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await apiClient.getCalendarExport(propertyId));
    } catch {
      showToast("Nie udało się sprawdzić adresu eksportu.");
    }
  }, [propertyId, showToast]);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .getCalendarExport(propertyId)
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) showToast("Nie udało się sprawdzić adresu eksportu.");
      });

    return () => {
      cancelled = true;
    };
  }, [propertyId, showToast]);

  async function issue(regenerate: boolean) {
    setPending(true);
    try {
      const result = regenerate
        ? await apiClient.regenerateCalendarExport(propertyId)
        : await apiClient.createCalendarExport(propertyId);

      setFreshUrl(result.url);
      showToast(
        regenerate
          ? "Nowy adres gotowy. Poprzedni przestał działać."
          : "Adres eksportu wygenerowany.",
      );
      await load();
    } catch {
      showToast("Nie udało się wygenerować adresu.");
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    setPending(true);
    try {
      await apiClient.revokeCalendarExport(propertyId);
      setFreshUrl(null);
      showToast("Adres unieważniony.");
      await load();
    } catch {
      showToast("Nie udało się unieważnić adresu.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      showToast("Skopiowano do schowka.");
    } catch {
      showToast("Skopiuj adres ręcznie — przeglądarka odmówiła dostępu do schowka.");
    }
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-[18px] font-bold tracking-tight">Eksport do innych serwisów</h3>
      <p className="mt-1.5 text-[13px] text-muted">
        Udostępnij swoje ręczne blokady innym platformom. Terminy zaimportowane z kalendarzy
        zewnętrznych nie są eksportowane — inaczej dwa serwisy blokowałyby się nawzajem
        w kółko.
      </p>

      {freshUrl ? (
        <div className="mt-4 rounded-[10px] border border-brand/30 bg-brand/6 px-3.5 py-3">
          <p className="text-[13px] font-bold">Skopiuj teraz — nie pokażemy go ponownie</p>
          <code className="mt-1.5 block overflow-x-auto text-[12px] break-all text-ink">
            {freshUrl}
          </code>
          <Button size="sm" variant="outline" className="mt-2.5" onClick={copy}>
            <Copy size={14} strokeWidth={2.4} />
            Kopiuj
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status?.active ? (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => issue(true)}>
              <RotateCcw size={14} strokeWidth={2.4} />
              Wygeneruj nowy
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={revoke}>
              <Trash2 size={14} strokeWidth={2.4} />
              Unieważnij
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => issue(false)}>
            <Download size={14} strokeWidth={2.4} />
            {pending ? "Generuję…" : "Wygeneruj adres"}
          </Button>
        )}
      </div>

      {status?.active && !freshUrl ? (
        <p className="mt-2 text-[12px] text-muted">
          Adres jest aktywny. Zgubiony link możesz tylko wygenerować od nowa.
        </p>
      ) : null}
    </div>
  );
}
