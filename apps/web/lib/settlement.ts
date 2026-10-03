/**
 * Presentation for the Host money lifecycle. Domain values stay English, and
 * the four stages stay distinct: what is owed, when it frees up, when it
 * reaches the connected account, and when it reaches the bank.
 */
export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Czeka na termin",
  AVAILABLE: "Dostępne",
  TRANSFER_PENDING: "Przekazywanie",
  TRANSFERRED: "Przekazane",
  CANCELLED: "Anulowane po zwrocie",
  FAILED: "Nieudane — ponowimy",
  REVERSAL_PENDING: "Cofanie po zwrocie",
  REVERSED: "Cofnięte",
};

export const PAYOUT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Przygotowywana",
  IN_TRANSIT: "W drodze do banku",
  PAID: "Na koncie",
  FAILED: "Nieudana",
  CANCELLED: "Anulowana",
};
