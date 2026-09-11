import { ApiProperty } from "@nestjs/swagger";

import { BOOKING_STATUSES } from "../../../infrastructure/database/schema";

/**
 * The Host dashboard contract.
 *
 * Everything here is a **read model** computed from the existing tables on
 * request. There is no dashboard state table: a second source of truth would
 * only ever drift from the Bookings and blocks it describes
 * (milestone 07 §5, §25).
 */
export const ATTENTION_TYPES = [
  "BOOKING_REQUEST_PENDING",
  "BOOKING_REQUEST_EXPIRING_SOON",
  "ICAL_SYNC_FAILED",
  "ICAL_SYNC_STALE",
  "PROPERTY_DRAFT",
  "PROPERTY_SUSPENDED",
  "PROPERTY_NOT_READY_FOR_PUBLISH",
] as const;
export type AttentionType = (typeof ATTENTION_TYPES)[number];

export const ATTENTION_SEVERITIES = ["ACTION", "WARNING", "INFO"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export class AttentionItemDto {
  @ApiProperty({ enum: ATTENTION_TYPES })
  type!: string;

  @ApiProperty({ enum: ATTENTION_SEVERITIES })
  severity!: string;

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  propertyId!: string | null;

  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  bookingId!: string | null;

  @ApiProperty({ example: "Nowa prośba o rezerwację" })
  title!: string;

  @ApiProperty({ example: "Sea View · 12–16 września" })
  description!: string;

  @ApiProperty({ example: "/host/bookings/…" })
  actionUrl!: string;

  @ApiProperty({ example: "2026-09-01T10:15:00.000Z" })
  occurredAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Termin, po którym sprawa przestanie być możliwa do załatwienia",
  })
  deadlineAt!: string | null;
}

/** One line in Today, Pending Requests or Upcoming Stays. */
export class OperationalBookingDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "RZV-7KD2M9QP" })
  reference!: string;

  @ApiProperty({ enum: BOOKING_STATUSES })
  status!: string;

  @ApiProperty({ format: "uuid" })
  propertyId!: string;

  @ApiProperty({ example: "Baltic Loft" })
  propertyTitle!: string;

  @ApiProperty({ example: "Jan Kowalski" })
  guestName!: string;

  @ApiProperty({ example: "2026-09-12" })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-16" })
  checkOut!: string;

  @ApiProperty({ example: 2 })
  adults!: number;

  @ApiProperty({ example: 1 })
  children!: number;

  @ApiProperty({ example: 192000 })
  totalAmountMinor!: number;

  @ApiProperty({ example: "PLN" })
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  hostResponseDeadlineAt!: string | null;
}

export class TodayDto {
  @ApiProperty({
    example: "2026-09-12",
    description: "Dzisiaj w strefie czasowej obiektów gospodarza",
  })
  date!: string;

  @ApiProperty({ type: [OperationalBookingDto] })
  arrivals!: OperationalBookingDto[];

  @ApiProperty({ type: [OperationalBookingDto] })
  departures!: OperationalBookingDto[];
}

export class PropertiesOverviewDto {
  @ApiProperty({ example: 5 })
  total!: number;

  @ApiProperty({ example: 3 })
  published!: number;

  @ApiProperty({ example: 1 })
  draft!: number;

  @ApiProperty({ example: 1 })
  suspended!: number;

  @ApiProperty({ example: 0 })
  archived!: number;
}

export class CalendarSyncHealthDto {
  @ApiProperty({ example: 5, description: "Kalendarze o statusie ACTIVE" })
  active!: number;

  @ApiProperty({ example: 4, description: "Zsynchronizowane w oczekiwanym oknie" })
  healthy!: number;

  @ApiProperty({ example: 1 })
  failed!: number;

  @ApiProperty({ example: 0, description: "Aktywne, ale dawno nieodświeżane" })
  stale!: number;

  @ApiProperty({ example: 2 })
  disabled!: number;
}

export class HostDashboardDto {
  @ApiProperty({
    type: [AttentionItemDto],
    description: "Posortowane po pilności, potem po terminie i czasie zdarzenia",
  })
  attention!: AttentionItemDto[];

  @ApiProperty({ type: TodayDto })
  today!: TodayDto;

  @ApiProperty({ type: [OperationalBookingDto] })
  pendingRequests!: OperationalBookingDto[];

  @ApiProperty({ type: [OperationalBookingDto] })
  upcomingStays!: OperationalBookingDto[];

  @ApiProperty({ type: PropertiesOverviewDto })
  properties!: PropertiesOverviewDto;

  @ApiProperty({ type: CalendarSyncHealthDto })
  calendarSync!: CalendarSyncHealthDto;
}
