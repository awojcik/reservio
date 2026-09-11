/**
 * Support needs to recognise an address, not to read it.
 *
 * "Is this the same person who wrote in?" is answered by the first letter and
 * the domain; the full mailbox is somebody's personal data and the admin panel
 * has no reason to hand it out in bulk (milestone 11 §8).
 *
 * The account's own email is shown unmasked on the User screen — support is
 * already looking at that one account on purpose — but every list, every
 * notification row and every Booking snapshot is masked.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";

  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);

  return `${head}${"*".repeat(Math.max(2, Math.min(local.length - 1, 5)))}@${domain}`;
}
