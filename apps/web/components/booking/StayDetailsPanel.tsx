import {
  Car,
  DoorOpen,
  KeyRound,
  LogOut,
  Phone,
  ScrollText,
  Wifi,
} from "lucide-react";

import type { StayDetails } from "@rezervio/api-client";

import { formatLongDateRange } from "@/lib/format";

/**
 * Everything the Guest needs for this Stay, in reading order.
 *
 * There is nothing to click here: no arrival confirmation, no check-out
 * button. The phase is computed from the dates and the Property's time zone
 * (milestone 09 §57, §58).
 */
const PHASE_LABELS: Record<string, string> = {
  BEFORE_STAY: "Przed pobytem",
  IN_STAY: "Trwa pobyt",
  AFTER_STAY: "Po pobycie",
};

export function StayDetailsPanel({ stay }: { stay: StayDetails }) {
  return (
    <section className="mt-5 rounded-[14px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[22px] font-bold tracking-tight">Twój pobyt</h2>
        <span className="text-[13px] font-bold text-muted">
          {PHASE_LABELS[stay.phase] ?? stay.phase}
        </span>
      </div>
      <p className="mt-1 text-[15px] text-muted">
        {formatLongDateRange(stay.checkIn, stay.checkOut)}
      </p>

      <div className="mt-6 space-y-5">
        <Block icon={<DoorOpen size={17} strokeWidth={2.3} />} title="Zameldowanie">
          <p className="font-semibold">od {stay.checkInTime}</p>
          {stay.arrivalInstructions ? <Body text={stay.arrivalInstructions} /> : null}
        </Block>

        <AccessBlock stay={stay} />

        {stay.wifiName || stay.wifiPassword ? (
          <Block icon={<Wifi size={17} strokeWidth={2.3} />} title="Wi-Fi">
            {stay.wifiName ? (
              <p>
                Sieć: <span className="font-semibold">{stay.wifiName}</span>
              </p>
            ) : null}
            {stay.wifiPassword ? (
              <p>
                Hasło:{" "}
                <span className="font-mono font-semibold tracking-wide">
                  {stay.wifiPassword}
                </span>
              </p>
            ) : null}
          </Block>
        ) : null}

        {stay.parkingInstructions ? (
          <Block icon={<Car size={17} strokeWidth={2.3} />} title="Parking">
            <Body text={stay.parkingInstructions} />
          </Block>
        ) : null}

        {stay.houseRules ? (
          <Block icon={<ScrollText size={17} strokeWidth={2.3} />} title="Zasady domu">
            <Body text={stay.houseRules} />
          </Block>
        ) : null}

        <Block icon={<LogOut size={17} strokeWidth={2.3} />} title="Wymeldowanie">
          <p className="font-semibold">do {stay.checkOutTime}</p>
          {stay.departureInstructions ? <Body text={stay.departureInstructions} /> : null}
        </Block>

        {stay.emergencyContact ? (
          <Block icon={<Phone size={17} strokeWidth={2.3} />} title="Kontakt awaryjny">
            <p className="font-semibold">{stay.emergencyContact}</p>
          </Block>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Before the reveal time the server sends no part of the secret, so there is
 * nothing here to hide — only a date to show (milestone 09 §16).
 */
function AccessBlock({ stay }: { stay: StayDetails }) {
  const { access } = stay;
  if (!access.configured) return null;

  if (!access.available) {
    const at = access.revealAt
      ? new Intl.DateTimeFormat("pl-PL", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: stay.timeZone,
        }).format(new Date(access.revealAt))
      : null;

    return (
      <Block icon={<KeyRound size={17} strokeWidth={2.3} />} title="Dostęp do obiektu">
        <p className="text-muted">
          {at ? (
            <>
              Dane wejścia będą dostępne <span className="font-semibold text-ink">{at}</span>
            </>
          ) : (
            "Dane wejścia pojawią się tu przed przyjazdem."
          )}
        </p>
      </Block>
    );
  }

  return (
    <Block icon={<KeyRound size={17} strokeWidth={2.3} />} title="Dostęp do obiektu">
      {access.accessCode ? (
        <p>
          Kod:{" "}
          <span className="font-mono text-[18px] font-bold tracking-widest">
            {access.accessCode}
          </span>
        </p>
      ) : null}
      {access.keyboxLocation ? <Body text={access.keyboxLocation} /> : null}
      {access.accessInstructions ? <Body text={access.accessInstructions} /> : null}
    </Block>
  );
}

function Block({
  icon,
  title,
  children,
}: Readonly<{ icon: React.ReactNode; title: string; children: React.ReactNode }>) {
  return (
    <div className="flex gap-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-brand">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        <div className="mt-1 space-y-1 text-[15px]">{children}</div>
      </div>
    </div>
  );
}

/** Host-authored text, rendered as text. Never as HTML (milestone 09 §33). */
function Body({ text }: { text: string }) {
  return <p className="whitespace-pre-line text-muted">{text}</p>;
}
