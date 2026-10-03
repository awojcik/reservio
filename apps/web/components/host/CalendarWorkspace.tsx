"use client";

import { useState } from "react";

import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { CalendarExport } from "./CalendarExport";
import { ExternalCalendars } from "./ExternalCalendars";

/**
 * Ties the three panels together: importing a feed or syncing it changes what
 * the calendar shows, so the grid is remounted rather than left stale.
 */
export function CalendarWorkspace({ propertyId }: { propertyId: string }) {
  const [revision, setRevision] = useState(0);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <AvailabilityCalendar key={revision} propertyId={propertyId} />

      <div className="space-y-6">
        <ExternalCalendars
          propertyId={propertyId}
          onChanged={() => setRevision((value) => value + 1)}
        />
        <CalendarExport propertyId={propertyId} />
      </div>
    </div>
  );
}
