import { HostHeader } from "@/components/host/HostHeader";
import { requireHost } from "@/lib/host-session";

/**
 * Route group so `/host`, `/host/properties`, … are guarded while
 * `/host/login` and `/host/register` stay public.
 */
export default async function HostAreaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const host = await requireHost();

  return (
    <>
      <HostHeader displayName={host.displayName} />
      <main className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">{children}</main>
    </>
  );
}
