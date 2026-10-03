"use client";

import { useMemo } from "react";

import { Conversation } from "@/components/booking/Conversation";
import { apiClient } from "@/lib/api";

/** The Guest side of the conversation for one Booking. */
export function GuestConversation({
  reference,
  hostName,
  canWrite,
}: {
  reference: string;
  hostName: string;
  canWrite: boolean;
}) {
  const api = useMemo(
    () => ({
      load: (params: { limit?: number; before?: string }) =>
        apiClient.getGuestMessages(reference, params),
      send: (body: string) => apiClient.sendGuestMessage(reference, body),
    }),
    [reference],
  );

  return (
    <Conversation
      api={api}
      title="Wiadomości z gospodarzem"
      placeholder="Napisz do gospodarza…"
      counterpartName={hostName}
      canWrite={canWrite}
    />
  );
}
