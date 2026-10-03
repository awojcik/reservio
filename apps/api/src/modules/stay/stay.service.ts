import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import {
  bookings,
  properties,
  propertySensitiveAccess,
  propertyStayInformation,
  type BookingRow,
  type PropertySensitiveAccessRow,
  type PropertyStayInformationRow,
} from "../../infrastructure/database/schema";
import { hoursBefore, stayPhase, stayWindow, type StayWindow } from "../../domain/stay";
import { StaySecretCipher } from "./stay-secret-cipher";
import type {
  BookingAccessStatusDto,
  GuestSensitiveAccessDto,
  SensitiveAccessDto,
  StayDetailsDto,
  StayInformationDto,
  UpdateSensitiveAccessDto,
  UpdateStayInformationDto,
} from "./dto/stay.dto";

/** Sensible defaults, so a Property with no configuration still has a Stay. */
const DEFAULTS = {
  checkInTime: "15:00",
  checkOutTime: "11:00",
  instructionsSendOffsetHours: 24,
  revealOffsetHours: 6,
};

export type StaySchedule = {
  bookingId: string;
  window: StayWindow;
  /** When the instructions email should go out. */
  instructionsAt: Date;
  /** When the access details become readable, ignoring any manual override. */
  scheduledRevealAt: Date;
  /** When the checkout reminder should go out. */
  checkoutReminderAt: Date;
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
};

@Injectable()
export class StayService {
  private readonly logger = new Logger(StayService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly cipher: StaySecretCipher,
  ) {}

  // ------------------------------------------------------------ host config

  async stayInformationFor(hostId: string, propertyId: string): Promise<StayInformationDto> {
    const property = await this.ownedProperty(hostId, propertyId);
    const row = await this.stayRow(propertyId);

    return {
      propertyId,
      timeZone: property.timeZone,
      configured: row !== null,
      checkInTime: row?.checkInTime ?? DEFAULTS.checkInTime,
      checkOutTime: row?.checkOutTime ?? DEFAULTS.checkOutTime,
      arrivalInstructions: row?.arrivalInstructions ?? undefined,
      parkingInstructions: row?.parkingInstructions ?? undefined,
      wifiName: row?.wifiName ?? undefined,
      wifiPassword: row?.wifiPassword ?? undefined,
      houseRules: row?.houseRules ?? undefined,
      departureInstructions: row?.departureInstructions ?? undefined,
      emergencyContact: row?.emergencyContact ?? undefined,
      instructionsSendOffsetHours:
        row?.instructionsSendOffsetHours ?? DEFAULTS.instructionsSendOffsetHours,
    };
  }

  async saveStayInformation(
    hostId: string,
    propertyId: string,
    dto: UpdateStayInformationDto,
  ): Promise<StayInformationDto> {
    await this.ownedProperty(hostId, propertyId);

    const values = {
      propertyId,
      checkInTime: dto.checkInTime,
      checkOutTime: dto.checkOutTime,
      arrivalInstructions: blankToNull(dto.arrivalInstructions),
      parkingInstructions: blankToNull(dto.parkingInstructions),
      wifiName: blankToNull(dto.wifiName),
      wifiPassword: blankToNull(dto.wifiPassword),
      houseRules: blankToNull(dto.houseRules),
      departureInstructions: blankToNull(dto.departureInstructions),
      emergencyContact: blankToNull(dto.emergencyContact),
      instructionsSendOffsetHours: dto.instructionsSendOffsetHours,
      updatedAt: new Date(),
    };

    await this.database.db
      .insert(propertyStayInformation)
      .values(values)
      .onConflictDoUpdate({ target: propertyStayInformation.propertyId, set: values });

    this.logger.log({ event: "stay.information_saved", propertyId });
    return this.stayInformationFor(hostId, propertyId);
  }

  async sensitiveAccessFor(hostId: string, propertyId: string): Promise<SensitiveAccessDto> {
    await this.ownedProperty(hostId, propertyId);
    const row = await this.accessRow(propertyId);

    return {
      propertyId,
      configured: this.hasSecret(row),
      // A Host reads back their own Property; the ciphertext never leaves the DB.
      accessInstructions: this.cipher.decryptOrNull(row?.accessInstructionsEncrypted ?? null) ?? undefined,
      accessCode: this.cipher.decryptOrNull(row?.accessCodeEncrypted ?? null) ?? undefined,
      keyboxLocation: this.cipher.decryptOrNull(row?.keyboxLocationEncrypted ?? null) ?? undefined,
      revealOffsetHours: row?.revealOffsetHours ?? DEFAULTS.revealOffsetHours,
    };
  }

  async saveSensitiveAccess(
    hostId: string,
    propertyId: string,
    dto: UpdateSensitiveAccessDto,
  ): Promise<SensitiveAccessDto> {
    await this.ownedProperty(hostId, propertyId);

    const values = {
      propertyId,
      accessInstructionsEncrypted: this.cipher.encryptOrNull(dto.accessInstructions),
      accessCodeEncrypted: this.cipher.encryptOrNull(dto.accessCode),
      keyboxLocationEncrypted: this.cipher.encryptOrNull(dto.keyboxLocation),
      revealOffsetHours: dto.revealOffsetHours,
      updatedAt: new Date(),
    };

    await this.database.db
      .insert(propertySensitiveAccess)
      .values(values)
      .onConflictDoUpdate({ target: propertySensitiveAccess.propertyId, set: values });

    // Deliberately no plaintext in this line, and no length either.
    this.logger.log({ event: "stay.sensitive_access_saved", propertyId });
    return this.sensitiveAccessFor(hostId, propertyId);
  }

  // --------------------------------------------------------------- schedule

  /**
   * Every instant this Booking's stay lifecycle depends on.
   *
   * Computed from the Property's own configuration and time zone, so a Host in
   * Madrid and a Host in Auckland both get "24 hours before check-in" to mean
   * the same thing locally (milestone 09 §17).
   */
  async scheduleFor(bookingId: string): Promise<StaySchedule | null> {
    const [row] = await this.database.db
      .select({
        booking: bookings,
        timeZone: properties.timeZone,
        stay: propertyStayInformation,
        access: propertySensitiveAccess,
      })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .leftJoin(
        propertyStayInformation,
        eq(propertyStayInformation.propertyId, bookings.propertyId),
      )
      .leftJoin(
        propertySensitiveAccess,
        eq(propertySensitiveAccess.propertyId, bookings.propertyId),
      )
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) return null;

    const checkInTime = row.stay?.checkInTime ?? DEFAULTS.checkInTime;
    const checkOutTime = row.stay?.checkOutTime ?? DEFAULTS.checkOutTime;

    const window = stayWindow({
      checkIn: row.booking.checkIn,
      checkOut: row.booking.checkOut,
      checkInTime,
      checkOutTime,
      timeZone: row.timeZone,
    });

    return {
      bookingId,
      window,
      timeZone: row.timeZone,
      checkInTime,
      checkOutTime,
      instructionsAt: hoursBefore(
        window.checkInAt,
        row.stay?.instructionsSendOffsetHours ?? DEFAULTS.instructionsSendOffsetHours,
      ),
      scheduledRevealAt: hoursBefore(
        window.checkInAt,
        row.access?.revealOffsetHours ?? DEFAULTS.revealOffsetHours,
      ),
      // One rule, in one place: a day before the Guest has to be out.
      checkoutReminderAt: hoursBefore(window.checkOutAt, 24),
    };
  }

  // ------------------------------------------------------------ guest view

  /**
   * The Stay as the Guest sees it. The caller has already proved access to
   * this Booking — the reference alone is never enough (milestone 09 §41).
   */
  async detailsFor(bookingId: string): Promise<StayDetailsDto> {
    const [row] = await this.database.db
      .select({
        booking: bookings,
        timeZone: properties.timeZone,
        stay: propertyStayInformation,
      })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .leftJoin(
        propertyStayInformation,
        eq(propertyStayInformation.propertyId, bookings.propertyId),
      )
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) throw new NotFoundException("Nie znaleziono rezerwacji.");

    const schedule = (await this.scheduleFor(bookingId))!;
    const access = await this.guestAccessFor(row.booking, schedule.scheduledRevealAt);

    return {
      reference: row.booking.publicReference,
      propertyTitle: row.booking.propertyTitleSnapshot,
      timeZone: row.timeZone,
      checkIn: row.booking.checkIn,
      checkOut: row.booking.checkOut,
      checkInTime: schedule.checkInTime,
      checkOutTime: schedule.checkOutTime,
      checkInAt: schedule.window.checkInAt.toISOString(),
      checkOutAt: schedule.window.checkOutAt.toISOString(),
      phase: stayPhase(schedule.window),
      arrivalInstructions: row.stay?.arrivalInstructions ?? null,
      parkingInstructions: row.stay?.parkingInstructions ?? null,
      wifiName: row.stay?.wifiName ?? null,
      wifiPassword: row.stay?.wifiPassword ?? null,
      houseRules: row.stay?.houseRules ?? null,
      departureInstructions: row.stay?.departureInstructions ?? null,
      emergencyContact: row.stay?.emergencyContact ?? null,
      access,
    };
  }

  /**
   * The access details, or the promise of them.
   *
   * The decision is made here, in the backend, and the secret is simply not
   * present in the response until it is due. A frontend that forgot to hide it
   * would have nothing to leak (milestone 09 §9, §62).
   */
  private async guestAccessFor(
    booking: BookingRow,
    scheduledRevealAt: Date,
    now: Date = new Date(),
  ): Promise<GuestSensitiveAccessDto> {
    const row = await this.accessRow(booking.propertyId);

    if (!this.hasSecret(row)) {
      return {
        configured: false,
        available: false,
        revealAt: null,
        accessCode: null,
        accessInstructions: null,
        keyboxLocation: null,
        revealedManually: false,
      };
    }

    const manual = booking.sensitiveAccessRevealedAt;
    // A Host handing the code over early wins; the schedule is the fallback.
    const effectiveRevealAt = manual ?? scheduledRevealAt;
    const available =
      isRevealable(booking.status) && effectiveRevealAt.getTime() <= now.getTime();

    if (!available) {
      return {
        configured: true,
        available: false,
        revealAt: effectiveRevealAt.toISOString(),
        accessCode: null,
        accessInstructions: null,
        keyboxLocation: null,
        revealedManually: false,
      };
    }

    return {
      configured: true,
      available: true,
      revealAt: null,
      accessCode: this.cipher.decryptOrNull(row!.accessCodeEncrypted),
      accessInstructions: this.cipher.decryptOrNull(row!.accessInstructionsEncrypted),
      keyboxLocation: this.cipher.decryptOrNull(row!.keyboxLocationEncrypted),
      revealedManually: manual !== null,
    };
  }

  /** The same question, for the Host's manual-reveal panel. */
  async accessStatusFor(booking: BookingRow): Promise<BookingAccessStatusDto> {
    const schedule = await this.scheduleFor(booking.id);
    const row = await this.accessRow(booking.propertyId);
    const configured = this.hasSecret(row);

    const scheduledRevealAt = schedule?.scheduledRevealAt ?? null;
    const effective = booking.sensitiveAccessRevealedAt ?? scheduledRevealAt;

    return {
      bookingId: booking.id,
      configured,
      available:
        configured &&
        isRevealable(booking.status) &&
        effective !== null &&
        effective.getTime() <= Date.now(),
      scheduledRevealAt: scheduledRevealAt?.toISOString() ?? null,
      manualRevealAt: booking.sensitiveAccessRevealedAt?.toISOString() ?? null,
      revealOffsetHours: row?.revealOffsetHours ?? DEFAULTS.revealOffsetHours,
    };
  }

  /**
   * Hands the access details to one Guest, now.
   *
   * Scoped to this Booking on purpose: the Property's `reveal_offset_hours` is
   * untouched, so the next Guest still gets the Host's normal timing
   * (milestone 09 §20A).
   *
   * Idempotent: the update only fires while the column is still null, so a
   * second click changes nothing and sends nothing.
   */
  async revealForBooking(bookingId: string): Promise<{ revealed: boolean; at: Date }> {
    const updated = await this.database.db
      .update(bookings)
      .set({ sensitiveAccessRevealedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(bookings.id, bookingId),
          // `IS NULL` is what makes this safe to call twice.
          isNull(bookings.sensitiveAccessRevealedAt),
        ),
      )
      .returning({ at: bookings.sensitiveAccessRevealedAt });

    if (updated.length > 0) {
      this.logger.log({ event: "stay.sensitive_access_revealed", bookingId });
      return { revealed: true, at: updated[0].at! };
    }

    const [existing] = await this.database.db
      .select({ at: bookings.sensitiveAccessRevealedAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return { revealed: false, at: existing.at! };
  }

  // ----------------------------------------------------------------- helpers

  private async ownedProperty(hostId: string, propertyId: string) {
    const [property] = await this.database.db
      .select({ id: properties.id, timeZone: properties.timeZone, hostId: properties.hostId })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);

    if (!property) throw new NotFoundException("Nie znaleziono obiektu.");
    if (property.hostId !== hostId) {
      // 404, not 403: an id that is not yours should not be confirmed to exist.
      throw new NotFoundException("Nie znaleziono obiektu.");
    }

    return property;
  }

  private async stayRow(
    propertyId: string,
    executor: Executor = this.database.db,
  ): Promise<PropertyStayInformationRow | null> {
    const [row] = await executor
      .select()
      .from(propertyStayInformation)
      .where(eq(propertyStayInformation.propertyId, propertyId))
      .limit(1);

    return row ?? null;
  }

  private async accessRow(propertyId: string): Promise<PropertySensitiveAccessRow | null> {
    const [row] = await this.database.db
      .select()
      .from(propertySensitiveAccess)
      .where(eq(propertySensitiveAccess.propertyId, propertyId))
      .limit(1);

    return row ?? null;
  }

  private hasSecret(row: PropertySensitiveAccessRow | null): boolean {
    return Boolean(
      row &&
        (row.accessCodeEncrypted ||
          row.accessInstructionsEncrypted ||
          row.keyboxLocationEncrypted),
    );
  }
}

/**
 * Access details belong to a Stay that is actually happening. A cancelled or
 * expired Booking never opens the door (milestone 09 §41).
 */
function isRevealable(status: string): boolean {
  return status === "CONFIRMED" || status === "COMPLETED";
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

