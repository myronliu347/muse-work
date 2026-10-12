import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import type { Message as AgentMessage } from "@muse-work/agent";
import { MessageInput } from "../chat/MessageInput";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { MessageList } from "../chat/MessageList";
import { ContextTag } from "../shared/ContextTag";
import { linkifyFilePaths, parseMentions } from "../../utils/messageUtils";
import { resolveWorkspaceFilePath } from "../../utils/filePathDisplay";
import type { VsCodeApi } from "../../types";
import { classifyAssistantHref } from "./assistantLinks";
import "../../styles/Message.css";
import "../../styles/MessageInput.css";
import "../../styles/AssistantPage.css";

export type AssistantLine = {
  id: string;
  at: number;
  role: "user" | "assistant";
  message: string;
  images?: Array<{ data: string; mediaType: string }>;
  app?: "popo";
};

export type AssistantQueueItem = {
  type: "chat" | "issue" | "automation" | "permission";
  title: string;
  retry?: true;
  active?: true;
};

export type AssistantPageApi = {
  listAssistantQueue?: () => Promise<{ items: AssistantQueueItem[] }>;
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

/** Matches .assistant-log padding-top (--space-4) and .assistant-column gap. */
const LOG_SCROLL_MARGIN = 16;
const LOG_ROW_GAP = 18;
const LOG_ROW_ESTIMATE = 96;

const logRowHeights = new Map<string, number>();

const noopHost: VsCodeApi = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
};

function markdownHtml(text: string): string {
  const html = marked.parse(linkifyFilePaths(text), { gfm: true, breaks: true });
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
      ...((line as { app?: unknown }).app === "popo" ? { app: "popo" as const } : {}),
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

function asQueueItem(value: unknown): AssistantQueueItem | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as { type?: string; title?: string; retry?: unknown; active?: unknown };
  if (
    item.type !== "chat" &&
    item.type !== "issue" &&
    item.type !== "automation" &&
    item.type !== "permission"
  ) {
    return undefined;
  }
  if (typeof item.title !== "string" || !item.title) return undefined;
  return {
    type: item.type,
    title: item.title,
    ...(item.retry === true ? { retry: true } : {}),
    ...(item.active === true ? { active: true } : {}),
  };
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

function UserLine({
  line,
  onOpenFile,
  onLinkClick,
}: {
  line: AssistantLine;
  onOpenFile?: (path: string) => void;
  onLinkClick: (event: MouseEvent) => void;
}) {
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
      {line.app === "popo" ? <div className="assistant-bubble-source">POPO</div> : null}
      <div className="assistant-bubble assistant-bubble-user">
        <div className="assistant-user-content" onClick={onLinkClick}>
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
              const path = part.path || part.fileName || "";
              return (
                <ContextTag
                  key={index}
                  name={name}
                  path={path}
                  onClick={path && onOpenFile ? () => onOpenFile(path) : undefined}
                />
              );
            }
            if (!part.content) return null;
            const linked = linkifyFilePaths(part.content);
            const hasLink = linked !== part.content || /https?:\/\//.test(part.content);
            if (!hasLink) return <span key={index}>{part.content}</span>;
            return (
              <span
                key={index}
                className="assistant-user-text"
                dangerouslySetInnerHTML={{ __html: markdownHtml(part.content) }}
              />
            );
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
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
  onOpenUrl?: (url: string) => void;
}> = ({
  api,
  vscode = noopHost,
  showPanelToggle = false,
  onToggleDock,
  onOpenFile,
  onOpenUrl,
}) => {
  const [lines, setLines] = useState<AssistantLine[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "transcript">("chat");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentWorkdir, setAgentWorkdir] = useState<string | undefined>();
  const [agentError, setAgentError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [queue, setQueue] = useState<AssistantQueueItem[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const atTail = useRef(true);
  const loadingOlder = useRef(false);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => logRowHeights.get(lines[index]?.id ?? "") ?? LOG_ROW_ESTIMATE,
    measureElement: (node, entry) => {
      const element = node as HTMLElement;
      const box = entry?.borderBoxSize?.[0]?.blockSize;
      const measured = typeof box === "number" ? box : element.offsetHeight;
      const height = measured > 0 ? Math.round(measured) : 0;
      const id = lines[Number(element.getAttribute("data-index"))]?.id;
      if (id && height > 0) logRowHeights.set(id, height);
      if (height > 0) return height;
      return (id && logRowHeights.get(id)) || LOG_ROW_ESTIMATE;
    },
    overscan: 8,
    gap: LOG_ROW_GAP,
    scrollMargin: LOG_SCROLL_MARGIN,
    // anchorTo "end" keeps the visible row in place when older lines are
    // prepended, and follows new lines only while already at the bottom.
    anchorTo: "end",
    followOnAppend: true,
    getItemKey: (index) => lines[index]?.id ?? index,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    useFlushSync: false,
    useAnimationFrameWithResizeObserver: true,
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => {
        cb(rect.height > 0 ? rect : { width: rect.width || 800, height: 100_000 });
      }),
  });

  const measureRow = useCallback(
    (node: HTMLDivElement | null) => {
      virtualizer.measureElement(node);
    },
    [virtualizer],
  );

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
    if (!api.listAssistantQueue) return;
    let cancelled = false;
    void api.listAssistantQueue().then((page) => {
      if (!cancelled) setQueue(page.items.flatMap((item) => asQueueItem(item) ?? []));
    }).catch(() => undefined);
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
    if (mode !== "chat") return;
    const el = scroller.current;
    if (!el) return;
    atTail.current = true;
    el.scrollTop = el.scrollHeight;
  }, [mode]);

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
        items?: unknown;
      };
      if (data?.command === "assistant:queue" && Array.isArray(data.items)) {
        setQueue(data.items.flatMap((item) => asQueueItem(item) ?? []));
        return;
      }
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
    if (!first || !hasMore || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const page = await api.listAssistantMessages({ before: first.id, limit: 50 });
      setHasMore(page.hasMore);
      // Line ids are the virtualizer keys, so inserting older rows keeps the
      // row that was on screen in place.
      setLines((prev) => {
        const ids = new Set(prev.map((line) => line.id));
        return [...page.messages.filter((line) => !ids.has(line.id)), ...prev];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingOlder.current = false;
    }
  }, [api, hasMore, lines]);

  const openHref = (href: string) => {
    const target = classifyAssistantHref(href);
    if (!target) return;
    if (target.kind === "file") {
      onOpenFile?.(
        resolveWorkspaceFilePath(target.path, agentWorkdir),
        target.startLine,
        target.endLine,
      );
      return;
    }
    if (target.kind === "browser") {
      onOpenUrl?.(target.url);
      return;
    }
    vscode.postMessage({ command: "openExternal", url: target.url });
  };

  const handleLinkClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    openHref(href);
  };

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
      <section className="assistant-queue" aria-label="待处理队列">
        <div className="assistant-queue-card">
        <div className="assistant-queue-title">
          待处理{queue.length > 0 ? ` ${queue.length}` : ""}
        </div>
        {queue.length === 0 ? (
          <p className="assistant-queue-empty">没有等待的事件</p>
        ) : (
          <ol className="assistant-queue-list">
            {queue.map((item, index) => (
              <li key={`${item.type}-${index}`}>
                <span className="assistant-queue-state">
                  {item.active ? "处理中" : "等待"}
                </span>
                <span className="assistant-queue-kind">
                  {item.type === "chat"
                    ? "聊天"
                    : item.type === "issue"
                      ? "Issue"
                      : item.type === "permission"
                        ? "权限"
                        : "自动化"}
                </span>
                <span className="assistant-queue-label">{item.title}</span>
                {item.retry ? <span className="assistant-queue-retry">重试</span> : null}
              </li>
            ))}
          </ol>
        )}
        </div>
      </section>
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
              onOpenFile={(path, startLine, endLine) =>
                onOpenFile?.(
                  resolveWorkspaceFilePath(path, agentWorkdir),
                  startLine,
                  endLine,
                )
              }
              onOpenPreview={onOpenUrl}
              openHttpInBrowser
            />
          )}
        </div>
      ) : (
      <>
      <div
        className="assistant-log assistant-log--virtual"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (el.scrollTop < 24) void loadOlder();
        }}
      >
        <div className="assistant-column">
          {lines.length === 0 ? <p className="assistant-empty">还没有消息</p> : null}
          <div
            ref={virtualizer.containerRef}
            className="virtual-spacer"
          />
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const line = lines[virtualRow.index];
            if (!line) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={measureRow}
                className="virtual-row"
              >
                {line.role === "user" ? (
                  <UserLine
                    line={line}
                    onOpenFile={(path) =>
                      onOpenFile?.(resolveWorkspaceFilePath(path, agentWorkdir))
                    }
                    onLinkClick={handleLinkClick}
                  />
                ) : (
                  <div className="assistant-bubble-row assistant-bubble-row-assistant">
                    <div className="assistant-bubble-name">
                      Muse Bot
                      {line.app === "popo" ? (
                        <span className="assistant-bubble-source">POPO</span>
                      ) : null}
                    </div>
                    <div
                      className="assistant-bubble assistant-bubble-assistant message-content markdown-content"
                      onClick={handleLinkClick}
                      dangerouslySetInnerHTML={{ __html: markdownHtml(line.message) }}
                    />
                    <BubbleTime at={line.at} />
                  </div>
                )}
              </div>
            );
          })}
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
