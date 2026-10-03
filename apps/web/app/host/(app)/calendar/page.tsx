import type { Metadata } from "next";

import { UnifiedCalendar } from "@/components/host/UnifiedCalendar";

export const metadata: Metadata = { title: "Kalendarz" };

/**
 * One calendar for every Property (milestone 07 §12). It does not replace the
 * per-Property calendar, which is still where iCal import and export live.
 */
export default function HostCalendarPage() {
  return (
    <div className="py-8 sm:py-10">
      <p className="eyebrow">Kalendarz</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">
        Wszystkie obiekty w jednym widoku
      </h1>
      <p className="mt-3 max-w-[58ch] text-[16px] text-muted">
        Rezerwacje, blokady ręczne i terminy z kalendarzy zewnętrznych. Zaznacz zakres w
        wierszu obiektu, żeby zablokować lub zwolnić termin.
      </p>

      <UnifiedCalendar />
    </div>
  );
}
