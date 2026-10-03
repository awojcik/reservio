import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { AppError, AppErrorCode } from "../../../common/app-error";
import { DATABASE } from "../../../infrastructure/database/database.module";
import type { Database } from "../../../infrastructure/database/connection";
import {
  externalPropertyMappings,
  properties,
  type ExternalPropertyMappingRow,
} from "../../../infrastructure/database/schema";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const codes = [
    (error as { code?: string }).code,
    ((error as { cause?: { code?: string } }).cause ?? {}).code,
  ];
  return codes.includes(UNIQUE_VIOLATION);
}

/**
 * Which Rezervio Property is which listing at the provider.
 *
 * Always an explicit, Host-confirmed decision. A name similarity is offered as
 * a suggestion and never acted on: mapping "Apartament 2" to the wrong listing
 * would quietly start blocking the wrong calendar, and the first person to
 * notice would be a Guest standing outside an occupied flat
 * (milestone 12 §11, §23).
 */
@Injectable()
export class MappingsService {
  private readonly logger = new Logger(MappingsService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async listFor(connectionId: string): Promise<ExternalPropertyMappingRow[]> {
    return this.database.db
      .select()
      .from(externalPropertyMappings)
      .where(eq(externalPropertyMappings.connectionId, connectionId))
      .orderBy(externalPropertyMappings.createdAt);
  }

  /**
   * Creates one mapping.
   *
   * The Property is re-checked against the Host that owns the connection, so a
   * Host cannot map somebody else's Property by supplying its id — the
   * ownership question is answered here, not in the request
   * (milestone 12 §38).
   */
  async create(input: {
    connectionId: string;
    hostId: string;
    propertyId: string;
    externalPropertyId: string;
    externalPropertyName: string | null;
  }): Promise<ExternalPropertyMappingRow> {
    const [property] = await this.database.db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, input.propertyId), eq(properties.hostId, input.hostId)))
      .limit(1);

    if (!property) throw new NotFoundException("Nie znaleziono obiektu.");

    try {
      const [row] = await this.database.db
        .insert(externalPropertyMappings)
        .values({
          connectionId: input.connectionId,
          propertyId: input.propertyId,
          externalPropertyId: input.externalPropertyId,
          externalPropertyName: input.externalPropertyName,
          status: "ACTIVE",
        })
        .returning();

      this.logger.log({
        event: "connectivity.property_mapped",
        connectionId: input.connectionId,
        propertyId: input.propertyId,
      });

      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // Either side of the pair can collide, and the fix differs: unmap the
      // Property, or pick a different listing.
      throw new AppError(
        AppErrorCode.PROPERTY_ALREADY_MAPPED,
        "Ten obiekt albo ten listing jest już zmapowany w tym połączeniu.",
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * Removes a mapping.
   *
   * The blocks it produced are deliberately left alone: they describe
   * reservations that still exist at the provider, and deleting them would
   * free dates somebody has already sold. Unmapping stops future syncs, it does
   * not rewrite history (milestone 12 §15).
   */
  async remove(connectionId: string, mappingId: string): Promise<void> {
    const deleted = await this.database.db
      .delete(externalPropertyMappings)
      .where(
        and(
          eq(externalPropertyMappings.id, mappingId),
          eq(externalPropertyMappings.connectionId, connectionId),
        ),
      )
      .returning({ id: externalPropertyMappings.id });

    if (deleted.length === 0) throw new NotFoundException("Nie znaleziono mapowania.");

    this.logger.log({ event: "connectivity.property_unmapped", connectionId, mappingId });
  }

  async byExternalId(
    connectionId: string,
    externalPropertyId: string,
  ): Promise<ExternalPropertyMappingRow | null> {
    const [row] = await this.database.db
      .select()
      .from(externalPropertyMappings)
      .where(
        and(
          eq(externalPropertyMappings.connectionId, connectionId),
          eq(externalPropertyMappings.externalPropertyId, externalPropertyId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /**
   * Every active mapping for one Property, across providers.
   *
   * A Property can legitimately be connected to more than one system — a PMS
   * and a channel manager — so an outbound push fans out to all of them.
   */
  async activeForProperty(propertyId: string): Promise<ExternalPropertyMappingRow[]> {
    return this.database.db
      .select()
      .from(externalPropertyMappings)
      .where(
        and(
          eq(externalPropertyMappings.propertyId, propertyId),
          eq(externalPropertyMappings.status, "ACTIVE"),
        ),
      );
  }

  /**
   * A suggestion, not a decision.
   *
   * Case-insensitive exact title match only. Anything fuzzier produces
   * confident wrong answers, and a wrong mapping is worse than no mapping.
   */
  static suggest(
    listings: { externalId: string; name: string }[],
    propertyTitle: string,
  ): string | null {
    const needle = propertyTitle.trim().toLowerCase();
    const hit = listings.find((listing) => listing.name.trim().toLowerCase() === needle);
    return hit?.externalId ?? null;
  }
}
