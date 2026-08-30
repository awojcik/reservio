"use client";

import { CalendarDays, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ApiError,
  type HostProperty,
  type HostPropertyImage,
  type UpdateHostPropertyBody,
} from "@rezervio/api-client";

import { ImageManager } from "@/components/host/ImageManager";
import { LocationPicker } from "@/components/host/LocationPicker";
import { PropertyActions } from "@/components/host/PropertyActions";
import { StatusBadge } from "@/components/host/StatusBadge";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { AMENITY_LABELS } from "@/lib/format";
import {
  PROPERTY_TYPE_OPTIONS,
  PUBLISH_REQUIREMENT_LABELS,
  majorToMinor,
  minorToMajor,
} from "@/lib/host";
import type { Amenity } from "@/lib/types";

const FIELD =
  "h-12 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] font-semibold text-ink placeholder:font-medium placeholder:text-muted/70";
const AREA =
  "w-full rounded-[10px] border border-line bg-surface px-3.5 py-3 text-[15px] font-medium leading-relaxed text-ink placeholder:text-muted/70";

/** Local, editable mirror of the Host DTO. Money is edited in złoty. */
type FormState = {
  title: string;
  description: string;
  propertyType: string;
  bookingMode: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  district: string;
  countryCode: string;
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
  maxGuests: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  baseDailyRate: string;
  cleaningFee: string;
  currency: string;
  amenities: string[];
};

function toForm(property: HostProperty): FormState {
  return {
    title: property.title,
    description: property.description ?? "",
    propertyType: property.propertyType,
    bookingMode: property.bookingMode,
    addressLine1: property.address.addressLine1 ?? "",
    postalCode: property.address.postalCode ?? "",
    city: property.address.city,
    district: property.address.district,
    countryCode: property.address.countryCode,
    timeZone: property.address.timeZone,
    latitude: property.address.latitude,
    longitude: property.address.longitude,
    maxGuests: String(property.capacity.maxGuests),
    bedrooms: String(property.capacity.bedrooms),
    beds: String(property.capacity.beds),
    bathrooms: String(property.capacity.bathrooms),
    baseDailyRate: minorToMajor(property.pricing.baseDailyRateAmountMinor),
    cleaningFee: minorToMajor(property.pricing.cleaningFeeAmountMinor),
    currency: property.pricing.currency,
    amenities: property.amenities,
  };
}

export function PropertyEditor({
  initial,
  amenityCodes,
}: {
  initial: HostProperty;
  amenityCodes: string[];
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [property, setProperty] = useState(initial);
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  /** Snapshot of what the server last confirmed, for the unsaved-changes hint. */
  const [savedForm, setSavedForm] = useState<FormState>(() => toForm(initial));
  const [images, setImages] = useState<HostPropertyImage[]>(initial.images);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const saved = await apiClient.updateHostProperty(property.id, {
        title: form.title,
        description: form.description,
        propertyType: form.propertyType as "APARTMENT",
        bookingMode: form.bookingMode as "REQUEST_TO_BOOK",
        address: {
          addressLine1: form.addressLine1,
          postalCode: form.postalCode,
          city: form.city,
          district: form.district,
          countryCode: form.countryCode,
          timeZone: form.timeZone,
          ...(form.latitude !== null ? { latitude: form.latitude } : {}),
          ...(form.longitude !== null ? { longitude: form.longitude } : {}),
        },
        capacity: {
          maxGuests: Number(form.maxGuests) || 1,
          bedrooms: Number(form.bedrooms) || 0,
          beds: Number(form.beds) || 0,
          bathrooms: Number(form.bathrooms) || 0,
        },
        pricing: {
          baseDailyRateAmountMinor: majorToMinor(form.baseDailyRate),
          cleaningFeeAmountMinor: majorToMinor(form.cleaningFee),
          currency: form.currency as "PLN",
        },
        // The checkboxes are built from the canonical list the API itself
        // serves, and the API validates every code again on arrival.
        amenities: form.amenities as UpdateHostPropertyBody["amenities"],
      });

      setProperty(saved);
      setForm(toForm(saved));
      setSavedForm(toForm(saved));
      setImages(saved.images);
      router.refresh();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status === 400
          ? "Sprawdź poprawność pól — nie udało się zapisać."
          : "Nie udało się zapisać zmian.",
      );
      // Rethrow so a publish triggered from the sidebar does not proceed on a
      // save that failed.
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function saveFromButton() {
    try {
      await save();
      showToast("Zapisano zmiany.");
    } catch {
      // Already reported by save().
    }
  }

  // Images change the readiness the moment they are added or removed, so the
  // panel recomputes locally rather than waiting for the next save.
  const missing = property.publishReadiness.missing.filter((code) =>
    code === "MINIMUM_IMAGES" ? images.length < 3 : true,
  );
  const ready = missing.length === 0;

  return (
    <div className="py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={property.status} />
            <span className="text-[13px] text-muted">/{property.slug}</span>
          </div>
          <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
            {form.title || "Bez tytułu"}
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/host/properties/${property.id}/calendar`}
            className={buttonStyles("outline", "md")}
          >
            <CalendarDays size={16} strokeWidth={2.3} />
            Kalendarz
          </Link>
          <Link
            href={`/host/properties/${property.id}/preview`}
            className={buttonStyles("outline", "md")}
          >
            <ExternalLink size={16} strokeWidth={2.3} />
            Podgląd
          </Link>
          <Button size="md" onClick={saveFromButton} disabled={saving}>
            {saving ? "Zapisuję…" : dirty ? "Zapisz zmiany" : "Zapisano"}
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
        <div className="space-y-10">
          <Section title="Podstawowe informacje" step={1}>
            <Field label="Tytuł" hint="Od 5 do 120 znaków.">
              <input
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                className={FIELD}
                maxLength={120}
              />
            </Field>

            <Field label="Opis" hint={`${form.description.length} / minimum 80 znaków`}>
              <textarea
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                rows={7}
                maxLength={5000}
                className={AREA}
                placeholder="Opisz obiekt: układ, okolicę, dojazd, dla kogo jest idealny…"
              />
            </Field>

            <Field label="Typ obiektu">
              <div className="flex flex-wrap gap-2">
                {PROPERTY_TYPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] font-bold transition-colors ${
                      form.propertyType === option.value
                        ? "border-accent bg-accent/12 text-ink"
                        : "border-line bg-surface text-ink hover:border-ink/35"
                    }`}
                  >
                    <input
                      type="radio"
                      name="propertyType"
                      checked={form.propertyType === option.value}
                      onChange={() => set("propertyType", option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </Field>
          </Section>

          <Section title="Lokalizacja" step={2}>
            <p className="-mt-1 text-[14px] text-muted">
              Ulica i kod pocztowy są prywatne — goście widzą tylko miasto, dzielnicę i
              przybliżony punkt na mapie.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ulica i numer">
                <input
                  value={form.addressLine1}
                  onChange={(event) => set("addressLine1", event.target.value)}
                  className={FIELD}
                  placeholder="ul. Morska 12/3"
                />
              </Field>
              <Field label="Kod pocztowy">
                <input
                  value={form.postalCode}
                  onChange={(event) => set("postalCode", event.target.value)}
                  className={FIELD}
                  placeholder="80-001"
                />
              </Field>
              <Field label="Miasto">
                <input
                  value={form.city}
                  onChange={(event) => set("city", event.target.value)}
                  className={FIELD}
                  placeholder="Gdańsk"
                />
              </Field>
              <Field label="Dzielnica">
                <input
                  value={form.district}
                  onChange={(event) => set("district", event.target.value)}
                  className={FIELD}
                  placeholder="Brzeźno"
                />
              </Field>
              <Field label="Kod kraju">
                <input
                  value={form.countryCode}
                  onChange={(event) => set("countryCode", event.target.value.toUpperCase())}
                  className={FIELD}
                  maxLength={2}
                  placeholder="PL"
                />
              </Field>
              <Field label="Strefa czasowa">
                <input
                  value={form.timeZone}
                  onChange={(event) => set("timeZone", event.target.value)}
                  className={FIELD}
                  placeholder="Europe/Warsaw"
                />
              </Field>
            </div>

            <Field label="Punkt na mapie" hint="Kliknij mapę lub przeciągnij znacznik.">
              <LocationPicker
                latitude={form.latitude}
                longitude={form.longitude}
                onChange={(latitude, longitude) => {
                  setForm((current) => ({ ...current, latitude, longitude }));
                }}
              />
              <p className="mt-2 text-[13px] text-muted tabular-nums">
                {form.latitude !== null && form.longitude !== null
                  ? `${form.latitude}, ${form.longitude}`
                  : "Nie wskazano jeszcze lokalizacji"}
              </p>
            </Field>
          </Section>

          <Section title="Parametry" step={3}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Goście">
                <NumberInput value={form.maxGuests} onChange={(v) => set("maxGuests", v)} min={1} />
              </Field>
              <Field label="Sypialnie">
                <NumberInput value={form.bedrooms} onChange={(v) => set("bedrooms", v)} min={0} />
              </Field>
              <Field label="Łóżka">
                <NumberInput value={form.beds} onChange={(v) => set("beds", v)} min={0} />
              </Field>
              <Field label="Łazienki">
                <NumberInput value={form.bathrooms} onChange={(v) => set("bathrooms", v)} min={0} />
              </Field>
            </div>
          </Section>

          <Section title="Udogodnienia" step={4}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {amenityCodes.map((code) => (
                <Checkbox
                  key={code}
                  label={AMENITY_LABELS[code as Amenity] ?? code}
                  checked={form.amenities.includes(code)}
                  onChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      amenities: checked
                        ? [...current.amenities, code]
                        : current.amenities.filter((entry) => entry !== code),
                    }))
                  }
                />
              ))}
            </div>
          </Section>

          <Section title="Zdjęcia" step={5}>
            <ImageManager propertyId={property.id} images={images} onChange={setImages} />
          </Section>

          <Section title="Sposób rezerwacji" step={6}>
            <p className="-mt-1 text-[14px] text-muted">
              Decyduje, co dzieje się po wysłaniu formularza przez gościa.
            </p>
            <div className="space-y-2">
              {[
                {
                  value: "REQUEST_TO_BOOK",
                  label: "Prośba o rezerwację",
                  hint: "Ty akceptujesz każdą rezerwację. Termin pozostaje wolny dla innych, dopóki nie zaakceptujesz.",
                },
                {
                  value: "INSTANT_BOOK",
                  label: "Rezerwacja natychmiastowa",
                  hint: "Gość rezerwuje od razu, a termin blokuje się automatycznie.",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer gap-3 rounded-[10px] border p-3.5 transition-colors ${
                    form.bookingMode === option.value
                      ? "border-accent bg-accent/8"
                      : "border-line bg-surface hover:border-ink/35"
                  }`}
                >
                  <input
                    type="radio"
                    name="bookingMode"
                    checked={form.bookingMode === option.value}
                    onChange={() => set("bookingMode", option.value)}
                    className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-[15px] font-bold">{option.label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Cena" step={7}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cena za noc" hint="w złotych">
                <input
                  value={form.baseDailyRate}
                  onChange={(event) => set("baseDailyRate", event.target.value)}
                  inputMode="decimal"
                  className={FIELD}
                  placeholder="450"
                />
              </Field>
              <Field label="Opłata za sprzątanie" hint="może być 0">
                <input
                  value={form.cleaningFee}
                  onChange={(event) => set("cleaningFee", event.target.value)}
                  inputMode="decimal"
                  className={FIELD}
                  placeholder="100"
                />
              </Field>
              <Field label="Waluta">
                <select
                  value={form.currency}
                  onChange={(event) => set("currency", event.target.value)}
                  className={FIELD}
                >
                  {["PLN", "EUR", "USD", "GBP"].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-[88px] lg:self-start">
          <div className="rounded-[14px] border border-line bg-surface p-5">
            <p className="eyebrow">Krok 8</p>
            <h2 className="mt-1 text-[19px] font-bold tracking-tight">Publikacja</h2>

            {ready ? (
              <p className="mt-3 text-[14px] font-semibold text-success">
                Obiekt jest gotowy do publikacji.
              </p>
            ) : (
              <>
                <p className="mt-3 text-[14px] text-muted">Zanim opublikujesz, uzupełnij:</p>
                <ul className="mt-2 space-y-1.5">
                  {missing.map((code) => (
                    <li key={code} className="flex items-start gap-2 text-[14px] font-semibold">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
                      />
                      {PUBLISH_REQUIREMENT_LABELS[code] ?? code}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] text-muted">
                  Lista pochodzi z backendu i odświeża się po zapisaniu zmian.
                </p>
              </>
            )}

            {dirty ? (
              <p className="mt-3 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3 py-2 text-[13px] font-semibold">
                Masz niezapisane zmiany — zapiszemy je przed publikacją.
              </p>
            ) : null}

            <div className="mt-4 border-t border-line pt-4">
              <PropertyActions
                propertyId={property.id}
                status={property.status}
                size="md"
                onBeforeAction={save}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  step,
  children,
}: {
  title: string;
  step: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="eyebrow">Krok {step}</p>
      <h2 className="mt-1 text-[22px] font-bold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-bold">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[13px] text-muted">{hint}</span> : null}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
}: {
  value: string;
  onChange: (value: string) => void;
  min: number;
}) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={FIELD}
    />
  );
}
