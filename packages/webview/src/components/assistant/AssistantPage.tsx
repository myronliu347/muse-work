import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Message as AgentMessage } from "@muse-work/agent";
import { MessageInput } from "../chat/MessageInput";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { MessageList } from "../chat/MessageList";
import { ContextTag } from "../shared/ContextTag";
import { parseMentions } from "../../utils/messageUtils";
import type { VsCodeApi } from "../../types";
import "../../styles/Message.css";
import "../../styles/MessageInput.css";
import "../../styles/AssistantPage.css";

export type AssistantLine = {
  id: string;
  at: number;
  role: "user" | "assistant";
  message: string;
  images?: Array<{ data: string; mediaType: string }>;
};

export type AssistantPageApi = {
  listAssistantMessages: (query?: { before?: string; limit?: number }) => Promise<{
    messages: AssistantLine[];
    hasMore: boolean;
  }>;
  sendAssistantMessage: (
    message: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => Promise<unknown>;
  getAssistantSession?: () => Promise<{
    sessionId: string;
    title?: string;
    workdir?: string;
    working?: boolean;
  }>;
  getMessages?: (sessionId: string) => Promise<{ messages: unknown[] }>;
};

const noopHost: VsCodeApi = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
};

function markdownHtml(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true });
  return DOMPurify.sanitize(typeof html === "string" ? html : "", {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
    ],
    ALLOWED_ATTR: ["href"],
  });
}

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
      ...(Array.isArray((line as { images?: unknown }).images)
        ? {
            images: (
              (line as { images: Array<{ data?: string; mediaType?: string }> })
                .images
            ).flatMap((img) =>
              img && typeof img.data === "string" && img.data
                ? [
                    {
                      data: img.data,
                      mediaType:
                        typeof img.mediaType === "string" && img.mediaType
                          ? img.mediaType
                          : "image/png",
                    },
                  ]
                : [],
            ),
          }
        : {}),
    };
  }
  return undefined;
}

function formatBubbleTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function BubbleTime({ at }: { at: number }) {
  return (
    <time className="assistant-bubble-time" dateTime={new Date(at).toISOString()}>
      {formatBubbleTime(at)}
    </time>
  );
}

function UserLine({ line }: { line: AssistantLine }) {
  const parts = parseMentions(
    line.message,
    line.images?.map((img, index) => ({
      data: img.data,
      filename: `图片 ${index + 1}`,
    })),
  );
  const referenced = new Set<string>();
  return (
    <div className="assistant-bubble-row assistant-bubble-row-user">
      <div className="assistant-bubble assistant-bubble-user">
        <div className="assistant-user-content">
          {parts.map((part, index) => {
            if (part.type === "mention" && part.isImage && part.imageData) {
              referenced.add(part.imageData);
              return (
                <img
                  key={index}
                  className="assistant-user-image"
                  src={part.imageData}
                  alt=""
                />
              );
            }
            if (part.type === "mention" || part.type === "selection") {
              const name =
                (part.path || part.fileName || "文件")
                  .replace(/[/\\]$/, "")
                  .split(/[/\\]/)
                  .pop() || "文件";
              return (
                <ContextTag
                  key={index}
                  name={name}
                  path={part.path || part.fileName || ""}
                />
              );
            }
            if (!part.content) return null;
            return <span key={index}>{part.content}</span>;
          })}
          {line.images
            ?.filter((img) => !referenced.has(img.data))
            .map((img, index) => (
              <img
                key={`extra-${index}`}
                className="assistant-user-image"
                src={img.data}
                alt=""
              />
            ))}
        </div>
      </div>
      <BubbleTime at={line.at} />
    </div>
  );
}

export const AssistantPage: React.FC<{
  api: AssistantPageApi;
  vscode?: VsCodeApi;
  showPanelToggle?: boolean;
  onToggleDock?: () => void;
}> = ({ api, vscode = noopHost, showPanelToggle = false, onToggleDock }) => {
  const [lines, setLines] = useState<AssistantLine[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "transcript">("chat");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentWorkdir, setAgentWorkdir] = useState<string | undefined>();
  const [agentError, setAgentError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
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

  useEffect(() => {
    if (!api.getAssistantSession) return;
    let cancelled = false;
    void api.getAssistantSession().then((info) => {
      if (cancelled) return;
      if (info.workdir) setAgentWorkdir(info.workdir);
      if (info.working) setWorking(true);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (mode !== "transcript" || !api.getAssistantSession || !api.getMessages) {
      return;
    }
    let cancelled = false;
    const load = () => {
      void api
        .getAssistantSession!()
        .then(async (info) => {
          const page = await api.getMessages!(info.sessionId);
          if (cancelled) return;
          setAgentWorkdir(info.workdir);
          setAgentMessages(page.messages as AgentMessage[]);
          setAgentError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setAgentError(err instanceof Error ? err.message : String(err));
          }
        });
    };
    load();
    const timer = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, mode]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atTail.current) el.scrollTop = el.scrollHeight;
  }, [lines, working]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        command?: string;
        line?: unknown;
        working?: boolean;
      };
      if (data?.command === "assistant:status") {
        setWorking(Boolean(data.working));
        if (data.working) atTail.current = true;
        return;
      }
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

  async function send(
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) {
    const message = text.replace(/\u00A0/g, " ").trim();
    const attached = (images ?? []).filter((img) => img.data);
    if ((!message && attached.length === 0) || sending) return;
    setSending(true);
    setWorking(true);
    atTail.current = true;
    setError(null);
    try {
      const line = asLine(
        await api.sendAssistantMessage(
          message,
          attached.length > 0 ? attached : undefined,
        ),
      );
      atTail.current = true;
      if (line) appendLine(line);
    } catch (err) {
      setWorking(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="assistant-page">
      <header className="assistant-header">
        <div className="assistant-header-title">Muse Bot</div>
        <div className="assistant-header-actions">
          <div className="assistant-view-switch" role="group" aria-label="查看内容">
            <button
              type="button"
              aria-pressed={mode === "chat"}
              onClick={() => setMode("chat")}
            >
              对话
            </button>
            <button
              type="button"
              aria-pressed={mode === "transcript"}
              onClick={() => setMode("transcript")}
            >
              AI 消息
            </button>
          </div>
          {showPanelToggle && onToggleDock ? (
            <PanelToggleControl onToggleDock={onToggleDock} />
          ) : null}
        </div>
      </header>
      {mode === "transcript" ? (
        <div className="assistant-transcript">
          {agentError ? <p className="assistant-error">{agentError}</p> : null}
          {agentMessages.length === 0 && !agentError ? (
            <p className="assistant-empty">还没有消息</p>
          ) : (
            <MessageList
              messages={agentMessages}
              vscode={vscode}
              workdir={agentWorkdir}
            />
          )}
        </div>
      ) : (
      <>
      <div
        className="assistant-log"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (el.scrollTop < 24) void loadOlder();
        }}
      >
        <div className="assistant-column">
          {lines.length === 0 ? <p className="assistant-empty">还没有消息</p> : null}
          {lines.map((line) =>
            line.role === "user" ? (
              <UserLine key={line.id} line={line} />
            ) : (
              <div key={line.id} className="assistant-bubble-row assistant-bubble-row-assistant">
                <div className="assistant-bubble-name">Muse Bot</div>
                <div
                  className="assistant-bubble assistant-bubble-assistant message-content markdown-content"
                  dangerouslySetInnerHTML={{ __html: markdownHtml(line.message) }}
                />
                <BubbleTime at={line.at} />
              </div>
            ),
          )}
          {working ? (
            <div className="message-list-status-hint" data-testid="thinking-hint">
              <span className="message-list-status-dot" aria-hidden="true" />
              <span className="message-list-status-label text-shimmer">工作中....</span>
            </div>
          ) : null}
        </div>
      </div>
      {error ? <p className="assistant-error">{error}</p> : null}
      <div className="assistant-composer">
        <MessageInput
          vscode={vscode}
          isStreaming={false}
          disabled={sending}
          workdir={agentWorkdir}
          onAbortMessage={() => {}}
          onSendMessage={(text, images) => {
            void send(text, images);
          }}
        />
      </div>
      </>
      )}
    </div>
  );
};
