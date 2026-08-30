"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/host";

const FIELD =
  "h-12 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] font-semibold text-ink placeholder:font-medium placeholder:text-muted/70";

/**
 * Creating a Property asks for the bare minimum. Everything else is filled in
 * on the editor page — the draft exists first, so nothing is lost mid-form.
 */
export function CreatePropertyForm() {
  const router = useRouter();
  const { showToast } = useToast();

  const [title, setTitle] = useState("");
  const [propertyType, setPropertyType] = useState<string>("APARTMENT");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    try {
      const property = await apiClient.createHostProperty({
        title: title.trim() || undefined,
        propertyType: propertyType as "APARTMENT",
      });
      router.replace(`/host/properties/${property.id}`);
      router.refresh();
    } catch {
      showToast("Nie udało się utworzyć obiektu. Spróbuj ponownie.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 max-w-[520px] space-y-4">
      <div>
        <label htmlFor="title" className="mb-1.5 block text-[14px] font-bold">
          Nazwa obiektu
        </label>
        <input
          id="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Apartament nad morzem"
          className={FIELD}
        />
        <p className="mt-1.5 text-[13px] text-muted">
          Możesz ją później zmienić — do pierwszej publikacji adres obiektu dostosuje się
          do nazwy.
        </p>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[14px] font-bold">Typ obiektu</legend>
        <div className="flex flex-wrap gap-2">
          {PROPERTY_TYPE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] font-bold transition-colors ${
                propertyType === option.value
                  ? "border-accent bg-accent/12 text-ink"
                  : "border-line bg-surface text-ink hover:border-ink/35"
              }`}
            >
              <input
                type="radio"
                name="propertyType"
                value={option.value}
                checked={propertyType === option.value}
                onChange={() => setPropertyType(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" size="lg" variant="accent" disabled={pending}>
        {pending ? "Tworzę szkic…" : "Utwórz szkic"}
      </Button>
    </form>
  );
}
