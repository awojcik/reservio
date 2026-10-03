"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";

/**
 * Connecting a PMS.
 *
 * The key is verified at the provider before anything is stored, so a wrong
 * key fails here rather than becoming a connection that looks fine and
 * silently syncs nothing.
 *
 * The webhook password is shown once, on success. It cannot be read back —
 * Rezervio keeps only what it needs to compare against, and showing it twice
 * would mean keeping it somewhere readable (milestone 12 §28).
 */
export function ConnectHostawayForm() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ webhookUrl: string | null; secret: string } | null>(
    null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const connected = await apiClient.connectHostaway({ accountId, apiKey });
      setResult({
        webhookUrl: connected.integration.webhookUrl,
        secret: connected.webhookSecret ?? "",
      });
      router.refresh();
    } catch (caught) {
      const body = caught instanceof ApiError ? (caught.body as { message?: string }) : undefined;
      setError(body?.message ?? "Nie udało się połączyć z Hostaway.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-card border border-success/35 bg-success/8 p-5">
        <h2 className="text-[18px] font-bold tracking-tightest">Połączono</h2>
        <p className="mt-2 max-w-[62ch] text-[15px]">
          Wklej poniższe dane w Hostaway → Settings → Integrations → Webhooks. Hasło
          pokazujemy <strong>tylko raz</strong> — nie da się go odczytać później.
        </p>

        <dl className="mt-4 space-y-3">
          <div>
            <dt className="text-[12px] font-bold tracking-wide text-muted uppercase">
              Adres (URL)
            </dt>
            <dd>
              <code className="text-[13px] break-all">{result.webhookUrl}</code>
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-bold tracking-wide text-muted uppercase">
              Login
            </dt>
            <dd>
              <code className="text-[13px]">rezervio</code>
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-bold tracking-wide text-muted uppercase">
              Hasło
            </dt>
            <dd>
              <code className="text-[13px] break-all">{result.secret}</code>
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-[14px] text-muted">
          Webhook to szybka ścieżka. Nawet bez niego Rezervio odpytuje Hostaway okresowo —
          zgubione powiadomienie kosztuje opóźnienie, nie utratę rezerwacji.
        </p>

        <Button
          className="mt-5"
          onClick={() => router.push("/host/integrations")}
          variant="primary"
          size="sm"
        >
          Przejdź do mapowania obiektów
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-[520px] space-y-4">
      <div>
        <label htmlFor="accountId" className="text-[14px] font-bold">
          Account ID
        </label>
        <input
          id="accountId"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          required
          className="mt-1 h-11 w-full rounded-control border border-line bg-surface px-3 text-[15px] outline-none focus:border-brand"
        />
        <p className="mt-1 text-[13px] text-muted">
          Z panelu Hostaway → Settings → Hostaway API. To nie jest sekret.
        </p>
      </div>

      <div>
        <label htmlFor="apiKey" className="text-[14px] font-bold">
          API key
        </label>
        <input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required
          className="mt-1 h-11 w-full rounded-control border border-line bg-surface px-3 text-[15px] outline-none focus:border-brand"
        />
        <p className="mt-1 text-[13px] text-muted">
          Zapisujemy go zaszyfrowanego. Nie wraca przez API, nie trafia do logów i nie
          pokazujemy go nigdzie ponownie.
        </p>
      </div>

      {error ? (
        <p className="rounded-control border border-accent-edge/35 bg-accent/12 px-3 py-2 text-[14px] text-ink">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy || !accountId || !apiKey}>
        {busy ? "Sprawdzam dane…" : "Połącz Hostaway"}
      </Button>
    </form>
  );
}
