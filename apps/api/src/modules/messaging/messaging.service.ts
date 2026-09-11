import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import {
  bookingConversations,
  bookingMessages,
  bookings,
  hosts,
  type BookingRow,
  type MessageSenderType,
} from "../../infrastructure/database/schema";
import { OutboxService } from "../../infrastructure/outbox/outbox.service";
import type { MessageDto, MessagesPageDto } from "./dto/message.dto";

const DEFAULT_LIMIT = 30;

/**
 * How long after a Stay ends the conversation stays writable.
 *
 * A simple, stated rule rather than a lifecycle state machine: people finish
 * conversations after checkout — a forgotten charger, an invoice question —
 * and a month is long enough for that without keeping threads open forever
 * (milestone 09 §30).
 */
const WRITE_WINDOW_DAYS = 30;

export class ConversationClosedError extends ConflictException {
  constructor() {
    super({
      code: "CONVERSATION_CLOSED",
      message: "Ta rozmowa jest już zamknięta.",
    });
  }
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Reads one page of a conversation, newest first.
   *
   * Cursor pagination keyed on `created_at`: a conversation people keep adding
   * to would make offsets shift under the reader (milestone 09 §34).
   */
  async history(
    bookingId: string,
    viewer: MessageSenderType,
    options: { limit?: number; before?: string } = {},
  ): Promise<MessagesPageDto> {
    const conversation = await this.findConversation(bookingId);
    if (!conversation) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, 100);
    const cursor = options.before ? parseCursor(options.before) : null;

    const conditions = [eq(bookingMessages.conversationId, conversation.id)];
    if (cursor) {
      /*
       * Row-wise comparison rather than a bare timestamp: two messages sent in
       * the same millisecond would otherwise be indistinguishable to the
       * cursor, and one of them would be skipped between pages.
       */
      conditions.push(
        sql`(${bookingMessages.createdAt}, ${bookingMessages.id}) <
            (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    // One extra row answers "is there more" without a second count query.
    const rows = await this.database.db
      .select({
        id: bookingMessages.id,
        senderType: bookingMessages.senderType,
        body: bookingMessages.body,
        createdAt: bookingMessages.createdAt,
      })
      .from(bookingMessages)
      .where(and(...conditions))
      .orderBy(desc(bookingMessages.createdAt), desc(bookingMessages.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // The cursor is the oldest row on this page — read before reversing.
    const oldest = page.at(-1) ?? null;

    const names = await this.displayNames(bookingId);

    const items: MessageDto[] = page
      // Oldest first within the page: a chat reads downwards.
      .slice()
      .reverse()
      .map((row) => ({
        id: row.id,
        senderType: row.senderType,
        senderName: names[row.senderType as MessageSenderType] ?? "Rezervio",
        mine: row.senderType === viewer,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      }));

    return {
      items,
      nextCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
      hasMore,
    };
  }

  /**
   * Appends a message and queues the email for the other side.
   *
   * The notification intent is written in the same transaction as the message:
   * a failing mail server must never lose somebody's message, and a committed
   * message must never silently fail to notify (milestone 09 §36).
   */
  async send(
    booking: BookingRow,
    sender: { type: Exclude<MessageSenderType, "SYSTEM">; userId: string | null },
    body: string,
  ): Promise<MessageDto> {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException("Wiadomość nie może być pusta.");
    }
    if (!this.writable(booking)) throw new ConversationClosedError();

    const message = await this.database.db.transaction(async (tx) => {
      const conversationId = await this.ensureConversation(tx, booking.id);

      const [row] = await tx
        .insert(bookingMessages)
        .values({
          conversationId,
          senderUserId: sender.userId,
          senderType: sender.type,
          body: trimmed,
        })
        .returning();

      await tx
        .update(bookingConversations)
        .set({ updatedAt: new Date() })
        .where(eq(bookingConversations.id, conversationId));

      await this.outbox.record(tx, {
        type: "NOTIFICATION",
        aggregateType: "booking",
        aggregateId: booking.id,
        payload: {
          bookingId: booking.id,
          notificationType:
            sender.type === "GUEST" ? "BOOKING_MESSAGE_TO_HOST" : "BOOKING_MESSAGE_TO_GUEST",
          // Scopes the dedup key to this message, so every message mails once.
          refId: row.id,
        },
      });

      return row;
    });

    // The body is never logged: it is private to two people (milestone 09 §43).
    this.logger.log({
      event: "message.sent",
      bookingId: booking.id,
      messageId: message.id,
      senderType: sender.type,
    });

    const names = await this.displayNames(booking.id);

    return {
      id: message.id,
      senderType: message.senderType,
      senderName: names[sender.type] ?? "Rezervio",
      mine: true,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /**
   * Writing is allowed while the Stay is upcoming, running, or recently over.
   * Reading history stays open to both participants forever.
   */
  writable(booking: BookingRow): boolean {
    if (booking.status === "CANCELLED" || booking.status === "EXPIRED") return false;

    const closesAt =
      Date.parse(`${booking.checkOut}T00:00:00Z`) + WRITE_WINDOW_DAYS * 86_400_000;
    return Date.now() <= closesAt;
  }

  private async findConversation(bookingId: string) {
    const [row] = await this.database.db
      .select()
      .from(bookingConversations)
      .where(eq(bookingConversations.bookingId, bookingId))
      .limit(1);

    return row ?? null;
  }

  /** Created on the first message rather than with the Booking. */
  private async ensureConversation(tx: Executor, bookingId: string): Promise<string> {
    const [created] = await tx
      .insert(bookingConversations)
      .values({ bookingId })
      .onConflictDoNothing()
      .returning({ id: bookingConversations.id });

    if (created) return created.id;

    const [existing] = await tx
      .select({ id: bookingConversations.id })
      .from(bookingConversations)
      .where(eq(bookingConversations.bookingId, bookingId))
      .limit(1);

    return existing.id;
  }

  /** Who to show as the author of each side of the conversation. */
  private async displayNames(
    bookingId: string,
  ): Promise<Partial<Record<MessageSenderType, string>>> {
    const [row] = await this.database.db
      .select({ guestName: bookings.guestName, hostName: hosts.displayName })
      .from(bookings)
      .innerJoin(hosts, eq(hosts.id, bookings.hostId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) throw new NotFoundException("Nie znaleziono rezerwacji.");

    return { GUEST: row.guestName, HOST: row.hostName, SYSTEM: "Rezervio" };
  }
}

/**
 * An opaque cursor over `(created_at, id)`. Opaque on purpose: the client
 * passes it back unchanged, and the pair it encodes stays an implementation
 * detail of this query.
 */
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

function parseCursor(value: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");

  if (!id || Number.isNaN(at.getTime())) {
    throw new BadRequestException("Nieprawidłowy kursor.");
  }

  return { at, id };
}
