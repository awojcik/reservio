import type { Metadata } from "next";

import { BookingFilters } from "@/components/admin/BookingFilters";
import { BookingsTable } from "@/components/admin/BookingsTable";
import { Pagination } from "@/components/admin/Pagination";
import { createSessionApiClient } from "@/lib/api-server";

export const metadata: Metadata = { title: "Rezerwacje — admin" };

const PAGE_SIZE = 25;

/**
 * Every Booking, filtered and paged **on the server**.
 *
 * Fetching them all and filtering in the browser would work for a hundred rows
 * and stop working for the rest; the query is bounded and hits the indexes
 * (milestone 11 §36).
 */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const client = await createSessionApiClient();
  const bookings = await client.listAdminBookings(
    {
      search: params.search || undefined,
      status: params.status || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { cache: "no-store" },
  );

  return (
    <div className="py-8">
      <p className="eyebrow">Wsparcie</p>
      <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tightest">Rezerwacje</h1>

      <div className="mt-6">
        <BookingFilters search={params.search ?? ""} status={params.status ?? ""} />
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface p-4">
        <BookingsTable rows={bookings.items} />
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={bookings.total} />
    </div>
  );
}
