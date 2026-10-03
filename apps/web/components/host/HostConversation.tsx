"use client";

import { useMemo } from "react";

import { Conversation } from "@/components/booking/Conversation";
import { apiClient } from "@/lib/api";

/** The Host side of the conversation for one Booking. */
export function HostConversation({
  bookingId,
  guestName,
  canWrite,
}: {
  bookingId: string;
  guestName: string;
  canWrite: boolean;
}) {
  const api = useMemo(
    () => ({
      load: (params: { limit?: number; before?: string }) =>
        apiClient.getHostMessages(bookingId, params),
      send: (body: string) => apiClient.sendHostMessage(bookingId, body),
    }),
    [bookingId],
  );

  return (
    <Conversation
      api={api}
      title="Wiadomości z gościem"
      placeholder={`Napisz do ${guestName}…`}
      counterpartName={guestName}
      canWrite={canWrite}
    />
  );
}
