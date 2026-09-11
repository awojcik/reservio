"use client";

import { MessageSquare, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError, type Message, type MessagesPage } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

/**
 * A Booking-scoped conversation, kept fresh by polling.
 *
 * No WebSockets: two people exchanging a handful of messages around one Stay
 * do not need a socket per viewer, and a refetch every few seconds is both
 * simpler and sturdier (milestone 09 §35).
 */
const POLL_MS = 7000;
const MAX_LENGTH = 4000;

export type ConversationApi = {
  load: (params: { limit?: number; before?: string }) => Promise<MessagesPage>;
  send: (body: string) => Promise<Message>;
};

export function Conversation({
  api,
  title,
  placeholder,
  counterpartName,
  canWrite = true,
}: {
  api: ConversationApi;
  title: string;
  placeholder: string;
  counterpartName: string;
  canWrite?: boolean;
}) {
  const { showToast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  /*
   * `api` is memoised by the caller, so it is stable for the lifetime of one
   * conversation. Depending on it directly keeps the effects honest instead of
   * hiding the dependency in a ref.
   */
  const refresh = useCallback(async () => {
    const page = await api.load({ limit: 30 });
    setMessages((current) => merge(current, page.items));
    setCursor(page.nextCursor);
    setHasMore(page.hasMore);
  }, [api]);

  // First load. State is only touched after the await, and a stale response
  // from an unmounted panel is discarded.
  useEffect(() => {
    let cancelled = false;

    api
      .load({ limit: 30 })
      .then((page) => {
        if (cancelled) return;
        setMessages(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  // Polling while the conversation is on screen, plus a refetch when the tab
  // regains focus — the common case is a reply that arrived while away.
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, POLL_MS);

    const onFocus = () => void refresh().catch(() => undefined);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  async function loadOlder() {
    if (!cursor) return;
    try {
      const page = await api.load({ limit: 30, before: cursor });
      setMessages((current) => merge(page.items, current));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      showToast("Nie udało się wczytać starszych wiadomości.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    try {
      const message = await api.send(body);
      setMessages((current) => merge(current, [message]));
      setDraft("");
    } catch (error) {
      showToast(describe(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-5 rounded-[14px] border border-line bg-surface p-6">
      <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-tight">
        <MessageSquare size={19} strokeWidth={2.3} aria-hidden="true" />
        {title}
      </h2>

      {hasMore ? (
        <Button variant="ghost" size="sm" className="mt-3" onClick={loadOlder}>
          Pokaż starsze
        </Button>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-[15px] text-muted">Wczytuję rozmowę…</p>
        ) : failed ? (
          <p className="text-[15px] text-muted">Nie udało się wczytać rozmowy.</p>
        ) : messages.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-line bg-background px-4 py-6 text-center text-[14px] text-muted">
            Nie ma tu jeszcze żadnej wiadomości. Napisz do {counterpartName}, jeśli
            czegoś potrzebujesz.
          </p>
        ) : (
          <ul className="space-y-3" aria-live="polite">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn("flex", message.mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-[12px] px-3.5 py-2.5",
                    message.mine
                      ? "bg-brand text-surface"
                      : "border border-line bg-background text-ink",
                  )}
                >
                  <p
                    className={cn(
                      "text-[12px] font-bold",
                      message.mine ? "text-surface/70" : "text-muted",
                    )}
                  >
                    {message.senderName} · {time(message.createdAt)}
                  </p>
                  {/* Plain text, rendered as text — never dangerouslySetInnerHTML. */}
                  <p className="mt-0.5 text-[15px] whitespace-pre-line">{message.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canWrite ? (
        <form onSubmit={submit} className="mt-5 border-t border-line pt-4">
          <label className="sr-only" htmlFor="message-body">
            Treść wiadomości
          </label>
          <textarea
            id="message-body"
            rows={3}
            value={draft}
            maxLength={MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            className="w-full rounded-[10px] border border-line bg-background px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12px] text-muted tabular-nums">
              {draft.length}/{MAX_LENGTH}
            </span>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={sending || draft.trim().length === 0}
            >
              <Send size={15} strokeWidth={2.4} />
              {sending ? "Wysyłam…" : "Wyślij"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-5 border-t border-line pt-4 text-[14px] text-muted">
          Ta rozmowa jest zamknięta. Historia pozostaje dostępna.
        </p>
      )}
    </section>
  );
}

/** Union by id, oldest first — polling and sending both add to the same list. */
function merge(left: Message[], right: Message[]): Message[] {
  const byId = new Map(left.map((message) => [message.id, message]));
  for (const message of right) byId.set(message.id, message);

  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function time(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { code?: string; message?: { code?: string } } | undefined;
    if ((body?.code ?? body?.message?.code) === "CONVERSATION_CLOSED") {
      return "Ta rozmowa jest już zamknięta.";
    }
  }
  return "Nie udało się wysłać wiadomości. Spróbuj ponownie.";
}
