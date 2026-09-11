"use client";

import { Info, KeyRound, Save } from "lucide-react";
import { useState } from "react";

import type { SensitiveAccess, StayInformation } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

/**
 * Configured once per Property, not per Booking.
 *
 * A Host who corrects a wrong door description corrects it here, and every
 * upcoming Guest sees the correction — nothing is copied into a Booking
 * (milestone 09 §4, §13, §59).
 */
const FIELD =
  "w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";

const SEND_CHOICES = [
  { value: 24, label: "1 dzień przed" },
  { value: 48, label: "2 dni przed" },
  { value: 72, label: "3 dni przed" },
] as const satisfies readonly { value: StayInformation["instructionsSendOffsetHours"]; label: string }[];

const REVEAL_CHOICES = [
  { value: 6, label: "6 h przed" },
  { value: 12, label: "12 h przed" },
  { value: 24, label: "24 h przed" },
] as const satisfies readonly { value: SensitiveAccess["revealOffsetHours"]; label: string }[];

export function StayInformationEditor({
  propertyId,
  timeZone,
  initialStay,
  initialAccess,
}: {
  propertyId: string;
  timeZone: string;
  initialStay: StayInformation;
  initialAccess: SensitiveAccess;
}) {
  const { showToast } = useToast();

  const [stay, setStay] = useState(initialStay);
  const [access, setAccess] = useState(initialAccess);
  const [savingStay, setSavingStay] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

  function setStayField<K extends keyof StayInformation>(key: K, value: StayInformation[K]) {
    setStay((current) => ({ ...current, [key]: value }));
  }

  function setAccessField<K extends keyof SensitiveAccess>(key: K, value: SensitiveAccess[K]) {
    setAccess((current) => ({ ...current, [key]: value }));
  }

  async function saveStay() {
    setSavingStay(true);
    try {
      setStay(
        await apiClient.saveHostStayInformation(propertyId, {
          checkInTime: stay.checkInTime,
          checkOutTime: stay.checkOutTime,
          arrivalInstructions: stay.arrivalInstructions,
          parkingInstructions: stay.parkingInstructions,
          wifiName: stay.wifiName,
          wifiPassword: stay.wifiPassword,
          houseRules: stay.houseRules,
          departureInstructions: stay.departureInstructions,
          emergencyContact: stay.emergencyContact,
          instructionsSendOffsetHours: stay.instructionsSendOffsetHours,
        }),
      );
      showToast("Informacje dla gościa zapisane.");
    } catch {
      showToast("Nie udało się zapisać. Sprawdź godziny i spróbuj ponownie.");
    } finally {
      setSavingStay(false);
    }
  }

  async function saveAccess() {
    setSavingAccess(true);
    try {
      setAccess(
        await apiClient.saveHostSensitiveAccess(propertyId, {
          accessInstructions: access.accessInstructions,
          accessCode: access.accessCode,
          keyboxLocation: access.keyboxLocation,
          revealOffsetHours: access.revealOffsetHours,
        }),
      );
      showToast("Dane dostępu zapisane.");
    } catch {
      showToast("Nie udało się zapisać danych dostępu.");
    } finally {
      setSavingAccess(false);
    }
  }

  return (
    <div className="mt-12 space-y-12 border-t border-line pt-10">
      <section>
        <p className="eyebrow">Po rezerwacji</p>
        <h2 className="mt-1 text-[22px] font-bold tracking-tight">Informacje dla gościa</h2>
        <p className="mt-2 max-w-[60ch] text-[14px] text-muted">
          Rezervio wyśle je automatycznie przed przyjazdem. Nie musisz pamiętać o wysyłce
          przy każdej rezerwacji.
        </p>

        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Zameldowanie od" hint={`czas lokalny obiektu (${timeZone})`}>
              <input
                type="time"
                value={stay.checkInTime}
                onChange={(event) => setStayField("checkInTime", event.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="Wymeldowanie do" hint="czas lokalny obiektu">
              <input
                type="time"
                value={stay.checkOutTime}
                onChange={(event) => setStayField("checkOutTime", event.target.value)}
                className={FIELD}
              />
            </Field>
          </div>

          <Field label="Jak wejść" hint="dojazd, wejście, piętro">
            <textarea
              rows={3}
              value={stay.arrivalInstructions ?? ""}
              onChange={(event) => setStayField("arrivalInstructions", event.target.value)}
              className={FIELD}
              placeholder="Wejście od podwórza, drzwi po prawej…"
            />
          </Field>

          <Field label="Parking">
            <textarea
              rows={2}
              value={stay.parkingInstructions ?? ""}
              onChange={(event) => setStayField("parkingInstructions", event.target.value)}
              className={FIELD}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nazwa Wi-Fi">
              <input
                value={stay.wifiName ?? ""}
                onChange={(event) => setStayField("wifiName", event.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="Hasło Wi-Fi" hint="widoczne dla gościa po rezerwacji">
              <input
                value={stay.wifiPassword ?? ""}
                onChange={(event) => setStayField("wifiPassword", event.target.value)}
                className={FIELD}
              />
            </Field>
          </div>

          <Field label="Zasady domu" hint="jedyna część widoczna publicznie">
            <textarea
              rows={3}
              value={stay.houseRules ?? ""}
              onChange={(event) => setStayField("houseRules", event.target.value)}
              className={FIELD}
              placeholder="Cisza nocna od 22:00…"
            />
          </Field>

          <Field label="Instrukcja wymeldowania">
            <textarea
              rows={2}
              value={stay.departureInstructions ?? ""}
              onChange={(event) => setStayField("departureInstructions", event.target.value)}
              className={FIELD}
            />
          </Field>

          <Field label="Kontakt awaryjny" hint="telefon, pod który gość zadzwoni w razie problemu">
            <input
              value={stay.emergencyContact ?? ""}
              onChange={(event) => setStayField("emergencyContact", event.target.value)}
              className={FIELD}
              placeholder="+48 600 100 200"
            />
          </Field>

          <Field label="Wyślij szczegóły pobytu">
            <div className="flex flex-wrap gap-2">
              {SEND_CHOICES.map((choice) => (
                <Choice
                  key={choice.value}
                  label={choice.label}
                  selected={stay.instructionsSendOffsetHours === choice.value}
                  onSelect={() => setStayField("instructionsSendOffsetHours", choice.value)}
                />
              ))}
            </div>
          </Field>

          <Button variant="accent" size="md" disabled={savingStay} onClick={saveStay}>
            <Save size={16} strokeWidth={2.4} />
            {savingStay ? "Zapisuję…" : "Zapisz informacje"}
          </Button>
        </div>
      </section>

      <section>
        <p className="eyebrow">Wrażliwe</p>
        <h2 className="mt-1 flex items-center gap-2 text-[22px] font-bold tracking-tight">
          <KeyRound size={20} strokeWidth={2.3} aria-hidden="true" />
          Dane dostępu
        </h2>
        <p className="mt-2 max-w-[60ch] text-[14px] text-muted">
          Przechowujemy je zaszyfrowane i pokazujemy gościowi dopiero w wybranym momencie —
          nie zaraz po rezerwacji.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="Kod do drzwi / keybox">
            <input
              value={access.accessCode ?? ""}
              onChange={(event) => setAccessField("accessCode", event.target.value)}
              className={FIELD}
              placeholder="918273"
            />
          </Field>

          <Field label="Instrukcja dostępu">
            <textarea
              rows={3}
              value={access.accessInstructions ?? ""}
              onChange={(event) => setAccessField("accessInstructions", event.target.value)}
              className={FIELD}
              placeholder="Keybox przy skrzynkach pocztowych…"
            />
          </Field>

          <Field label="Gdzie jest keybox">
            <input
              value={access.keyboxLocation ?? ""}
              onChange={(event) => setAccessField("keyboxLocation", event.target.value)}
              className={FIELD}
            />
          </Field>

          <Field label="Udostępnij gościowi">
            <div className="flex flex-wrap gap-2">
              {REVEAL_CHOICES.map((choice) => (
                <Choice
                  key={choice.value}
                  label={choice.label}
                  selected={access.revealOffsetHours === choice.value}
                  onSelect={() => setAccessField("revealOffsetHours", choice.value)}
                />
              ))}
            </div>
          </Field>

          <p className="flex items-start gap-2 text-[13px] text-muted">
            <Info size={15} strokeWidth={2.3} className="mt-0.5 shrink-0" />
            Pojedynczemu gościowi możesz udostępnić dane wcześniej — w szczegółach jego
            rezerwacji. Nie zmienia to tego ustawienia.
          </p>

          <Button variant="accent" size="md" disabled={savingAccess} onClick={saveAccess}>
            <Save size={16} strokeWidth={2.4} />
            {savingAccess ? "Zapisuję…" : "Zapisz dane dostępu"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Choice({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-bold transition-colors ${
        selected
          ? "border-accent bg-accent/12 text-ink"
          : "border-line bg-surface text-ink hover:border-ink/35"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
  return (
    <label className="block">
      <span className="text-[14px] font-bold">{label}</span>
      {hint ? <span className="ml-2 text-[13px] text-muted">{hint}</span> : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
