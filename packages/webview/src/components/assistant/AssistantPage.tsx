import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "../../styles/AssistantPage.css";

export type AssistantLine = {
  id: string;
  at: number;
  role: "user" | "assistant";
  message: string;
};

export type AssistantPageApi = {
  listAssistantMessages: (query?: { before?: string; limit?: number }) => Promise<{
    messages: AssistantLine[];
    hasMore: boolean;
  }>;
  sendAssistantMessage: (message: string) => Promise<unknown>;
};

function asLine(value: unknown): AssistantLine | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { line?: AssistantLine; id?: string; role?: string; message?: string; at?: number };
  const line = record.line?.role ? record.line : record;
  if (
    (line.role === "user" || line.role === "assistant") &&
    typeof line.id === "string" &&
    typeof line.message === "string"
  ) {
    return {
      id: line.id,
      at: typeof line.at === "number" ? line.at : Date.now(),
      role: line.role,
      message: line.message,
    };
  }
  return undefined;
}

export const AssistantPage: React.FC<{ api: AssistantPageApi }> = ({ api }) => {
  const [lines, setLines] = useState<AssistantLine[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atTail = useRef(true);
  const loadingOlder = useRef(false);

  const appendLine = useCallback((line: AssistantLine) => {
    setLines((prev) => (prev.some((item) => item.id === line.id) ? prev : [...prev, line]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .listAssistantMessages({ limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setLines(page.messages);
        setHasMore(page.hasMore);
        atTail.current = true;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atTail.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { command?: string; line?: unknown };
      if (data?.command !== "assistant:chat") return;
      const line = asLine(data.line);
      if (!line) return;
      const follow = atTail.current;
      appendLine(line);
      if (!follow) atTail.current = false;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appendLine]);

  const loadOlder = useCallback(async () => {
    const first = lines[0];
    const el = scroller.current;
    if (!first || !hasMore || loadingOlder.current) return;
    loadingOlder.current = true;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await api.listAssistantMessages({ before: first.id, limit: 50 });
      setHasMore(page.hasMore);
      setLines((prev) => {
        const ids = new Set(prev.map((line) => line.id));
        return [...page.messages.filter((line) => !ids.has(line.id)), ...prev];
      });
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingOlder.current = false;
    }
  }, [api, hasMore, lines]);

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const line = asLine(await api.sendAssistantMessage(message));
      setDraft("");
      atTail.current = true;
      if (line) appendLine(line);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="assistant-page">
      <div
        className="assistant-log"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (el.scrollTop < 24) void loadOlder();
        }}
      >
        {lines.length === 0 ? <p className="assistant-empty">还没有消息</p> : null}
        {lines.map((line) => (
          <div key={line.id} className={`assistant-bubble assistant-bubble--${line.role}`}>
            <div className="assistant-bubble-role">{line.role === "user" ? "我" : "助理"}</div>
            <div className="assistant-bubble-text">{line.message}</div>
          </div>
        ))}
      </div>
      {error ? <p className="assistant-error">{error}</p> : null}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          rows={2}
          placeholder="给助理发消息"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          发送
        </button>
      </form>
    </div>
  );
};
