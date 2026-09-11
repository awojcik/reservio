import { timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { ConnectionsService } from "../application/connections.service";
import { ExternalSyncWorker } from "../application/external-sync.worker";
import { ProviderEventsService } from "../application/provider-events.service";
import { WebhookAckDto } from "../dto/webhook.dto";

/** Constant-time compare, so a wrong secret cannot be found a byte at a time. */
function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type HostawayWebhookBody = {
  /** Hostaway's own event id, when it sends one. */
  id?: number | string;
  event?: string;
  object?: string;
  accountId?: number | string;
  data?: { id?: number | string; reservationId?: string; listingMapId?: number | string };
};

/**
 * Hostaway's webhook.
 *
 * Hostaway does **not** sign its webhooks. Its published contract offers a
 * username and password that it will pass on the Authorization header, and
 * nothing else — so that is what this endpoint validates, against a secret
 * Rezervio generated rather than one a Host chose. Inventing a signature
 * scheme here would be inventing a contract the provider does not have
 * (milestone 12 §28, §48).
 *
 * The connection is named in the path so the lookup does not depend on the
 * body, which is unauthenticated until the header has been checked.
 */
@ApiTags("connectivity")
@Controller("webhooks/hostaway")
export class HostawayWebhookController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly events: ProviderEventsService,
    private readonly worker: ExternalSyncWorker,
  ) {}

  @Post(":connectionId")
  @HttpCode(200)
  @ApiOperation({
    summary: "Webhook Hostaway",
    description:
      "Hostaway nie podpisuje webhooków — jego kontrakt przewiduje wyłącznie Basic Auth. Zdarzenie jest przyjmowane i przetwarzane asynchronicznie; powtórka zwraca 200 i nie wywołuje drugiego efektu.",
  })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiUnauthorizedResponse({ description: "Nieprawidłowe dane w nagłówku Authorization" })
  async receive(
    @Param("connectionId") connectionId: string,
    @Req() request: FastifyRequest,
    @Body() body: HostawayWebhookBody,
  ): Promise<WebhookAckDto> {
    const connection = await this.connections.byId(connectionId);
    const expected = connection ? webhookSecretOf(connection.configurationJson) : null;

    /*
     * One rejection for every reason: an unknown connection, a connection with
     * no webhook secret and a wrong password all answer the same way. A
     * distinct response would turn this endpoint into a way to enumerate which
     * connection ids exist.
     */
    if (!connection || !expected || !secretMatches(basicAuthPassword(request) ?? "", expected)) {
      throw new UnauthorizedException("Nieprawidłowe dane uwierzytelniające webhooka.");
    }

    const reservationId = body.data?.id ?? body.data?.reservationId;
    if (reservationId === undefined) {
      // Nothing actionable — a message event, or a shape we do not handle.
      return { received: true, duplicate: false };
    }

    /*
     * Hostaway does not guarantee a unique delivery id, so the event identity
     * is composed from what it does send: the connection, the event name and
     * the reservation. Two deliveries of the same change collapse; a genuine
     * later change to the same reservation is a different event name or is
     * caught by the reconciliation sweep either way.
     */
    const providerEventId = `${connectionId}:${body.event ?? "reservation"}:${reservationId}:${body.id ?? ""}`;

    const accepted = await this.events.accept({
      provider: "HOSTAWAY",
      connectionId,
      providerEventId,
      eventType: `${body.event ?? "reservation.updated"}:${reservationId}`,
      payload: body,
    });

    if (!accepted.accepted) return { received: true, duplicate: false };

    /*
     * Queued rather than processed inline. Hostaway's acknowledgement timeout
     * is twenty seconds and applying the event means calling Hostaway back;
     * a slow provider would otherwise make it retry a delivery we are already
     * handling (milestone 12 §28).
     */
    if (!accepted.duplicate) await this.worker.enqueueWebhook(accepted.eventId);

    return { received: true, duplicate: accepted.duplicate };
  }
}

/** The password Hostaway was configured to send. Never logged, never returned. */
function webhookSecretOf(configurationJson: string | null): string | null {
  if (!configurationJson) return null;

  try {
    return (JSON.parse(configurationJson) as { webhookSecret?: string }).webhookSecret ?? null;
  } catch {
    return null;
  }
}

function basicAuthPassword(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.toLowerCase().startsWith("basic ")) return null;

  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator === -1 ? null : decoded.slice(separator + 1);
  } catch {
    return null;
  }
}
