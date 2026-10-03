import { loadIdentity } from "@/lib/session";
import { HeaderShell } from "./HeaderShell";

/**
 * Server wrapper: resolves who is signed in and hands it to the presentational
 * header. Client Components render `HeaderShell` directly and receive the
 * identity as a prop instead.
 */
export async function Header({ className }: { className?: string }) {
  const identity = await loadIdentity();

  return (
    <HeaderShell
      className={className}
      identity={identity ? { isHost: identity.host !== null } : null}
    />
  );
}
