"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ApiError, type PropertyDetail } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { BOOKING_MODE_CTA } from "@/lib/booking";
import {
  formatAmountMinor,
  formatGuests,
  formatLongDateRange,
  formatNights,
} from "@/lib/format";

const FIELD =
  "h-12 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] font-semibold text-ink placeholder:font-medium placeholder:text-muted/70";

type BookingFormProps = {
  property: PropertyDetail;
  bookingMode: string;
  /** Filled in from the signed-in profile, when there is one. */
  prefill?: { name: string; email: string; phone: string };
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount: number;
};

export function BookingForm({
  property,
  bookingMode,
  prefill,
  checkIn,
  checkOut,
  adults,
  childrenCount,
}: BookingFormProps) {
  const router = useRouter();

  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * One key per mounted form, so a double submit — or a retry after a dropped
   * response — resolves to the same Booking instead of a second one.
   */
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const instant = bookingMode === "INSTANT_BOOK";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const booking = await apiClient.createBooking(
        {
          propertyId: property.id,
          checkIn,
          checkOut,
          adults,
          children: childrenCount,
          guest: { name, email, ...(phone.trim() ? { phone } : {}) },
        },
        idempotencyKey,
      );

      router.replace(`/booking/status/${booking.reference}`);
    } catch (caught) {
      setError(describe(caught));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="rounded-[14px] border border-line bg-surface p-5">
        <p className="eyebrow">Twój pobyt</p>
        <h2 className="mt-1 text-[20px] font-bold tracking-tight">{property.title}</h2>
        <p className="mt-1 text-[15px] text-muted">
          {property.city}, {property.district}
        </p>

        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Termin</dt>
            <dd className="font-semibold">{formatLongDateRange(checkIn, checkOut)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Goście</dt>
            <dd className="font-semibold">{formatGuests(adults, childrenCount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Długość</dt>
            <dd className="font-semibold">{formatNights(property.price.nights)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
            <dt className="font-bold">Razem</dt>
            <dd className="text-[19px] font-bold tabular-nums">
              {formatAmountMinor(property.price.totalAmountMinor)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[13px] text-muted">
          Cenę wylicza Rezervio na podstawie stawki gospodarza — potwierdzimy ją ponownie
          przy zapisie.
        </p>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-5">
        <p className="eyebrow">Dane kontaktowe</p>
        <h2 className="mt-1 text-[20px] font-bold tracking-tight">Kto przyjeżdża?</h2>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-bold">Imię i nazwisko</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="name"
              placeholder="Jan Kowalski"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[14px] font-bold">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              autoComplete="email"
              placeholder="jan@example.com"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[14px] font-bold">
              Telefon <span className="font-medium text-muted">(opcjonalnie)</span>
            </span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              autoComplete="tel"
              placeholder="+48 600 100 200"
              className={FIELD}
            />
          </label>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-2.5 text-[14px] font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" variant="accent" className="w-full" disabled={pending}>
          {pending ? "Wysyłam…" : (BOOKING_MODE_CTA[bookingMode] ?? "Zarezerwuj")}
        </Button>

        <p className="mt-3 text-center text-[13px] text-muted">
          {instant
            ? "Termin zostanie zablokowany na czas dokończenia rezerwacji. Płatności jeszcze nie pobieramy."
            : "Gospodarz musi zaakceptować prośbę. Do tego czasu termin pozostaje dostępny dla innych."}
        </p>
      </div>
    </form>
  );
}

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "Coś poszło nie tak. Spróbuj ponownie.";

  const body = error.body as { code?: string; message?: { code?: string } } | undefined;
  const code = body?.code ?? body?.message?.code;

  if (code === "PROPERTY_NOT_AVAILABLE") {
    return "Ten termin właśnie przestał być dostępny. Wybierz inny.";
  }
  if (code === "IDEMPOTENCY_KEY_REUSED") {
    return "Ta próba została już zapisana z innymi danymi. Odśwież stronę.";
  }
  if (code === "CANNOT_BOOK_OWN_PROPERTY") {
    return "To Twój własny obiekt — nie możesz go u siebie zarezerwować.";
  }
  if (error.status === 400) return "Sprawdź poprawność danych.";
  if (error.status === 404) return "Tego obiektu nie da się już zarezerwować.";
  if (error.status === 0) return "Nie udało się połączyć z API Rezervio.";
  return "Coś poszło nie tak. Spróbuj ponownie.";
}
