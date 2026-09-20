import { CalendarDays, CheckCircle2, Clock, Luggage, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ApiError, type Booking } from "@rezervio/api-client";

import { BookingStatusPoller } from "@/components/booking/BookingStatusPoller";
import { BookingTimeline } from "@/components/booking/BookingTimeline";
import { CancelBookingButton } from "@/components/booking/CancelBookingButton";
import { GuestAccessExchange } from "@/components/booking/GuestAccessExchange";
import { ClaimBookingPanel } from "@/components/booking/ClaimBookingPanel";
import { HoldCountdown } from "@/components/booking/HoldCountdown";
import { GuestConversation } from "@/components/booking/GuestConversation";
import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { StayDetailsPanel } from "@/components/booking/StayDetailsPanel";
import { Header } from "@/components/layout/Header";
import { buttonStyles } from "@/components/ui/Button";
import { createSessionApiClient } from "@/lib/api-server";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_REASONS,
  PAYMENT_STATUS_LABELS,
  isTerminal,
} from "@/lib/booking";
import { formatAmountMinor, formatGuests, formatLongDateRange } from "@/lib/format";
import { loadIdentity } from "@/lib/session";

type PageProps = {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Status rezerwacji" };

const DEADLINE = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "long",
  timeStyle: "short",
});

export default async function BookingStatusPage({ params, searchParams }: PageProps) {
  const { reference } = await params;
  const resolved = await searchParams;
  const token = typeof resolved.token === "string" ? resolved.token : undefined;

  // Cookies are forwarded, so a Guest who already exchanged their token is
  // recognised without one in the URL.
  const [client, identity] = await Promise.all([
    createSessionApiClient(),
    loadIdentity(),
  ]);

  let booking: Booking;
  try {
    booking = await client.getBooking(reference, { cache: "no-store" });
  } catch (error) {
    const unauthorised = error instanceof ApiError && error.status === 401;
    if (!unauthorised) throw error;

    // First visit from an email link: swap the token for a cookie, then reload
    // without it.
    if (token) return <GuestAccessExchange reference={reference} token={token} />;

    return (
      <>
        <Header />
        <main className="mx-auto max-w-[640px] px-4 py-16 sm:px-6">
          <div className="rounded-[14px] border border-line bg-surface p-6">
            <h1 className="text-[22px] font-bold tracking-tight">
              Ta rezerwacja jest prywatna
            </h1>
            <p className="mt-2 text-[15px] text-muted">
              Otwórz ją linkiem z wiadomości email, którą wysłaliśmy po złożeniu
              rezerwacji. Sam numer rezerwacji nie wystarcza.
            </p>
          </div>
        </main>
      </>
    );
  }

  /*
   * The Stay details only exist once the Booking is real. Fetched separately
   * so a Booking still awaiting a decision costs nothing extra.
   */
  const showsStay = booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const stay = showsStay
    ? await client.getStayDetails(reference, { cache: "no-store" }).catch(() => null)
    : null;

  const awaitingHost = booking.status === "PENDING_HOST_APPROVAL";
  const awaitingPayment = booking.status === "PENDING_PAYMENT";
  const confirmed = booking.status === "CONFIRMED";
  const finished = isTerminal(booking.status);

  // The provider has the money but the confirming webhook has not landed yet.
  const settling =
    awaitingPayment &&
    (booking.payment?.status === "PROCESSING" ||
      booking.payment?.status === "SUCCEEDED");
  const declined = awaitingPayment && booking.payment?.status === "FAILED";
  const expiredWithoutStay =
    booking.status === "EXPIRED" && booking.statusReason === "PAYMENT_AFTER_HOLD_EXPIRY";

  const Icon = finished ? XCircle : awaitingHost ? Clock : CheckCircle2;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[640px] px-4 pb-20 sm:px-6">
        <div className="mt-8 rounded-[14px] border border-line bg-surface p-6">
          <Icon
            size={30}
            strokeWidth={2.2}
            className={finished ? "text-accent-edge" : "text-brand"}
          />

          <h1 className="mt-3 text-[26px] leading-tight font-bold tracking-tightest">
            {awaitingHost
              ? "Prośba została wysłana"
              : confirmed
                ? "Rezerwacja potwierdzona"
                : settling
                  ? "Przetwarzamy płatność"
                  : awaitingPayment
                    ? "Termin jest dla Ciebie zablokowany"
                    : BOOKING_STATUS_LABELS[booking.status]}
          </h1>

          <p className="mt-2 text-[15px] text-muted">
            {awaitingHost
              ? "Gospodarz musi ją zaakceptować. Do tego czasu rezerwacja nie jest potwierdzona."
              : confirmed
                ? "Płatność została zaksięgowana, a termin jest zarezerwowany dla Ciebie."
                : settling
                  ? "Potwierdzenie przychodzi od operatora płatności. Ta strona odświeży się sama."
                  : expiredWithoutStay
                    ? "Płatność dotarła po wygaśnięciu blokady terminu. Zleciliśmy pełny zwrot."
                    : awaitingPayment
                      ? "Zapłać, żeby potwierdzić rezerwację."
                      : (BOOKING_STATUS_REASONS[booking.statusReason ?? ""] ??
                        "Ta rezerwacja nie jest już aktywna.")}
          </p>

          {/* Polled, not asserted: only the backend can say a Booking is paid. */}
          {settling ? <BookingStatusPoller /> : null}

          {declined ? (
            <p
              role="alert"
              className="mt-4 rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-2.5 text-[14px]"
            >
              Płatność nie powiodła się. Spróbuj ponownie przed wygaśnięciem blokady.
              {booking.payment?.failureMessage ? (
                <span className="mt-1 block text-muted">
                  {booking.payment.failureMessage}
                </span>
              ) : null}
            </p>
          ) : null}

          {awaitingHost && booking.hostResponseDeadlineAt ? (
            <p className="mt-4 rounded-[10px] border border-line bg-background px-3.5 py-2.5 text-[14px]">
              Gospodarz ma czas na odpowiedź do{" "}
              <span className="font-bold">
                {DEADLINE.format(new Date(booking.hostResponseDeadlineAt))}
              </span>
            </p>
          ) : null}

          {awaitingPayment && !settling && booking.holdExpiresAt ? (
            <p className="mt-4 rounded-[10px] border border-line bg-background px-3.5 py-2.5 text-[14px]">
              Termin trzymamy jeszcze <HoldCountdown expiresAt={booking.holdExpiresAt} />
            </p>
          ) : null}

          <dl className="mt-6 space-y-2 border-t border-line pt-5 text-[15px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Numer</dt>
              <dd className="font-bold tabular-nums">{booking.reference}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Status</dt>
              <dd className="font-semibold">{BOOKING_STATUS_LABELS[booking.status]}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Obiekt</dt>
              <dd className="font-semibold">{booking.propertyTitle}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Termin</dt>
              <dd className="font-semibold">
                {formatLongDateRange(booking.checkIn, booking.checkOut)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Goście</dt>
              <dd className="font-semibold">
                {formatGuests(booking.adults, booking.children)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
              <dt className="font-bold">Razem</dt>
              <dd className="text-[19px] font-bold tabular-nums">
                {formatAmountMinor(booking.price.totalAmountMinor)}
              </dd>
            </div>
            {booking.payment ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Płatność</dt>
                <dd className="font-semibold">
                  {PAYMENT_STATUS_LABELS[booking.payment.status ?? ""] ??
                    booking.payment.status}
                </dd>
              </div>
            ) : null}
          </dl>

          {/* Offered only while the Booking belongs to nobody. */}
          {!booking.allowedActions.claimed && !finished ? (
            <ClaimBookingPanel
              reference={booking.reference}
              signedIn={identity !== null}
            />
          ) : null}

          <BookingTimeline entries={booking.timeline} />

          {/* Offered only when the backend says it is allowed. */}
          {booking.allowedActions.canCancel ? (
            <div className="mt-6 border-t border-line pt-5">
              <CancelBookingButton reference={booking.reference} awaitingHost={awaitingHost} />
            </div>
          ) : null}
        </div>

        {/* The backend decides whether paying is still possible; the panel is
            a consequence of that answer, never its own judgement. */}
        {booking.allowedActions.canPay && !settling ? (
          <PaymentPanel
            reference={booking.reference}
            totalAmountMinor={booking.price.totalAmountMinor}
            holdExpiresAt={booking.holdExpiresAt}
          />
        ) : null}

        {stay ? <StayDetailsPanel stay={stay} /> : null}

        {/* Messaging exists inside a Booking, and only there (milestone 09 §24). */}
        {!finished || booking.status === "COMPLETED" ? (
          <GuestConversation
            reference={booking.reference}
            hostName="gospodarza"
            canWrite={booking.status !== "CANCELLED" && booking.status !== "EXPIRED"}
          />
        ) : null}

        {/*
          Where to go from here. A confirmation screen whose only exit was
          "search again" was a dead end for the Guest who had just signed in
          and wanted the booking filed under their trips (§7).
        */}
        <div className="mt-5 flex flex-wrap gap-3">
          {/* Only once the Booking belongs to the account — otherwise the
              trip page would answer 404 and the claim panel above is the
              right next step. */}
          {identity && booking.allowedActions.claimed ? (
            <Link
              href={`/account/trips/${booking.reference}`}
              className={buttonStyles("primary", "md")}
            >
              <Luggage size={16} strokeWidth={2.3} />
              Moje podróże
            </Link>
          ) : null}

          <Link href="/search" className={buttonStyles("outline", "md")}>
            <CalendarDays size={16} strokeWidth={2.3} />
            Szukaj dalej
          </Link>
        </div>
      </main>
    </>
  );
}
