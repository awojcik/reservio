import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/admin/Pagination";
import { RetryNotificationButton } from "@/components/admin/RetryNotificationButton";
import { StatePill } from "@/components/admin/StatusPill";
import { formatInstant } from "@/lib/admin";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Powiadomienia — admin" };

const PAGE_SIZE = 50;

/**
 * Notification deliveries, failures first.
 *
 * One row per logical notification, keyed by its dedup key — which is also why
 * a retry is safe: claiming the row is what grants the right to send, so a
 * message that already went out cannot go out twice (milestone 11 §12).
 */
export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const client = await createSessionApiClient();
  const notifications = await client.listAdminNotifications(
    {
      status: params.status || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { cache: "no-store" },
  );

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">Powiadomienia</h1>
      <p className="mt-3 max-w-[70ch] text-[16px] text-muted">
        Adresy są maskowane. Email nigdy nie wozi sekretów i nigdy nie blokuje transakcji —
        nieudana wysyłka nie cofa zmiany stanu, którą opisuje.
      </p>

      <nav className="mt-6 flex gap-2" aria-label="Status powiadomień">
        <FilterLink label="Wszystkie" href="/admin/notifications" active={!params.status} />
        <FilterLink
          label="Nieudane"
          href="/admin/notifications?status=FAILED"
          active={params.status === "FAILED"}
        />
        <FilterLink
          label="Oczekujące"
          href="/admin/notifications?status=PENDING"
          active={params.status === "PENDING"}
        />
      </nav>

      <div className="mt-6 rounded-card border border-line bg-surface">
        {notifications.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            Brak powiadomień w tym stanie.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {notifications.items.map((notification) => (
              <li
                key={notification.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <StatePill status={notification.status} />
                <span className="text-[14px] font-bold">{notification.type}</span>
                <Link
                  href={`/admin/bookings/${notification.bookingId}`}
                  className="text-[14px] font-bold text-brand underline underline-offset-2"
                >
                  {notification.bookingReference}
                </Link>
                <span className="text-[14px] text-muted">
                  {notification.recipientType} · {notification.recipientMasked}
                </span>
                <span className="text-[13px] text-muted">
                  {notification.attemptCount} prób
                  {notification.lastErrorCode ? ` · ${notification.lastErrorCode}` : ""}
                  {" · "}
                  {formatInstant(notification.sentAt ?? notification.updatedAt)}
                </span>
                {notification.status !== "SENT" ? (
                  <span className="ml-auto">
                    <RetryNotificationButton notificationId={notification.id} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={notifications.total} />
    </div>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex h-9 items-center rounded-full border border-brand bg-brand px-3.5 text-[13px] font-bold text-surface"
          : "inline-flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-bold transition-colors hover:border-brand"
      }
    >
      {label}
    </Link>
  );
}
