import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import type { Message as AgentMessage } from "@muse-work/agent";
import { MessageInput, type MessageInputHandle } from "../chat/MessageInput";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { MessageList } from "../chat/MessageList";
import { FileIcon } from "../panels/FileIcon";
import { ContextTag } from "../shared/ContextTag";
import { MarkdownView } from "../message/MarkdownView";
import { linkifyFilePaths, parseMentions } from "../../utils/messageUtils";
import { resolveWorkspaceFilePath } from "../../utils/filePathDisplay";
import { materializeMessageImages } from "../../utils/messageImages";
import { pathToFileUrl } from "../../utils/pathToFileUrl";
import type { AttachedImage, VsCodeApi } from "../../types";
import {
  classifyAssistantHref,
  collectAssistantFilePaths,
  isHtmlPreviewPath,
  splitAssistantFileLines,
  stripClosedFileLinks,
} from "./assistantLinks";
import { openImagePreview, type PreviewImage } from "../message/imagePreview";
import "../../styles/Message.css";
import "../../styles/MessageInput.css";
import "../../styles/AssistantPage.css";

export type AssistantLine = {
  id: string;
  at: number;
  role: "user" | "assistant";
  message: string;
  images?: Array<{ data: string; mediaType: string }>;
  app?: string;
  /** 这条回复引用的 Issue。标题引用可点击并切到它。 */
  issueId?: string;
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
  clearAssistantMessages?: () => Promise<unknown>;
  getAssistantSession?: () => Promise<{
    sessionId: string;
    title?: string;
    workdir?: string;
    working?: boolean;
    compacting?: boolean;
  }>;
  getMessages?: (
    sessionId: string,
    query?: { before?: string; limit?: number },
  ) => Promise<{ messages: unknown[]; hasMore?: boolean }>;
};

function mergeTranscriptTail<T extends { id: string }>(
  prev: T[],
  tail: T[],
  keepOlder: boolean,
): T[] {
  if (!keepOlder || prev.length === 0) return tail;
  const incoming = new Set(tail.map((message) => message.id));
  const prefix = prev.filter((message) => message.id && !incoming.has(message.id));
  return [...prefix, ...tail];
}

/** Matches .assistant-log padding-top (--space-4) and .assistant-column gap. */
const LOG_SCROLL_MARGIN = 16;
const LOG_ROW_GAP = 18;
const LOG_ROW_ESTIMATE = 96;

const logRowHeights = new Map<string, number>();

type AssistantComposerDraft = { text: string; images: AttachedImage[] };

// 助手页切走会卸载整页。未发送的内容留在这里，回来时再填进输入框。
let assistantComposerDraft: AssistantComposerDraft = { text: "", images: [] };

function readAssistantComposerDraft(): AssistantComposerDraft {
  return assistantComposerDraft;
}

function writeAssistantComposerDraft(draft: AssistantComposerDraft) {
  assistantComposerDraft = { text: draft.text, images: draft.images.slice() };
}

export function clearAssistantComposerDraft() {
  assistantComposerDraft = { text: "", images: [] };
}

const noopHost: VsCodeApi = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
};

const CHANNEL_IMAGE_TAG = /\[img\](https?:\/\/[^\s[\]]+)\[\/img\]/gi;

/** 渠道把图片写成 `[img]url[/img]`。抽出来单独显示，正文里不再留这串标记。 */
function channelImageUrls(message: string): { text: string; urls: string[] } {
  const urls: string[] = [];
  const text = message
    .replace(CHANNEL_IMAGE_TAG, (_match, url: string) => {
      urls.push(url);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, urls };
}

/** 气泡上来源条。muse 和空渠道不标。 */
function sourceApp(app: string | undefined): string | undefined {
  const value = app?.trim();
  if (!value || value === "muse") return undefined;
  return value;
}

function withIssueQuote(html: string, issueId: string | undefined): string {
  const id = issueId?.trim();
  if (!id || !html.includes("<blockquote>")) return html;
  const safe = id.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return html.replace(
    "<blockquote>",
    `<blockquote class="assistant-issue-quote" data-issue-id="${safe}">`,
  );
}

/** Absolute paths stay links until the host says they cannot be opened. */
function keepsFileLinkUntilProbe(filePath: string): boolean {
  return (
    filePath.startsWith("/") ||
    filePath.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  );
}

function markdownHtml(text: string, closed: ReadonlySet<string> = new Set()): string {
  const html = marked.parse(linkifyFilePaths(text), { gfm: true, breaks: true });
  const safe = DOMPurify.sanitize(typeof html === "string" ? html : "", {
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
    ALLOWED_ATTR: ["href", "class"],
  });
  return stripClosedFileLinks(safe, closed);
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
    const app = sourceApp(
      typeof (line as { app?: unknown }).app === "string"
        ? (line as { app: string }).app
        : undefined,
    );
    return {
      id: line.id,
      at: typeof line.at === "number" ? line.at : Date.now(),
      role: line.role,
      message: line.message,
      ...(app ? { app } : {}),
      ...(typeof (line as { issueId?: unknown }).issueId === "string" &&
      (line as { issueId: string }).issueId.trim()
        ? { issueId: (line as { issueId: string }).issueId.trim() }
        : {}),
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

function assignInputRef(
  ref: Ref<MessageInputHandle> | undefined,
  value: MessageInputHandle | null,
) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  ref.current = value;
}

function AssistantComposer({
  vscode,
  workdir,
  mentionIssues,
  inputRef,
  onSend,
}: {
  vscode: VsCodeApi;
  workdir?: string;
  mentionIssues?: Array<{ id: string; title: string }>;
  inputRef?: Ref<MessageInputHandle>;
  onSend: (
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
}) {
  const focusRef = useRef<MessageInputHandle>(null);
  // 挂载时拍一份草稿。输入过程中不把草稿再传回 inputContent，避免光标被重置。
  const [initialDraft] = useState(() => readAssistantComposerDraft());
  const persistDraft = useCallback((draft: AssistantComposerDraft) => {
    writeAssistantComposerDraft(draft);
  }, []);
  return (
    <MessageInput
      ref={(handle) => {
        focusRef.current = handle;
        assignInputRef(inputRef, handle);
      }}
      vscode={vscode}
      isStreaming={false}
      workdir={workdir}
      mentionIssues={mentionIssues}
      placeholder="想让我做的事，写在这里"
      inputContent={initialDraft.text || undefined}
      initialAttachedImages={
        initialDraft.images.length > 0 ? initialDraft.images : undefined
      }
      onPersistDraft={persistDraft}
      onAbortMessage={() => {}}
      onSendMessage={(text, images) => {
        onSend(text, images);
        focusRef.current?.focus();
      }}
    />
  );
}

function BubbleTime({ at }: { at: number }) {
  return (
    <time className="assistant-bubble-time" dateTime={new Date(at).toISOString()}>
      {formatBubbleTime(at)}
    </time>
  );
}

function UserShot({
  src,
  alt,
  gallery,
  index,
  onPreviewImage,
}: {
  src: string;
  alt: string;
  gallery: PreviewImage[];
  index: number;
  onPreviewImage: (
    src: string,
    alt: string,
    gallery: PreviewImage[],
    index: number,
  ) => void;
}) {
  return (
    <button
      type="button"
      className="assistant-user-shot"
      onClick={() => onPreviewImage(src, alt, gallery, index)}
    >
      <img src={src} alt={alt} draggable={false} />
    </button>
  );
}

function UserLine({
  line,
  onOpenFile,
  onPreviewImage,
}: {
  line: AssistantLine;
  onOpenFile?: (path: string) => void;
  onPreviewImage: (
    src: string,
    alt: string,
    gallery: PreviewImage[],
    index: number,
  ) => void;
}) {
  const { text, urls } = channelImageUrls(line.message);
  const parts = parseMentions(
    text,
    line.images?.map((img, index) => ({
      data: img.data,
      filename: `图片 ${index + 1}`,
    })),
  );
  const referenced = new Set<string>();
  const shots: Array<{ src: string; alt: string }> = [];
  const body = parts.map((part, index) => {
    if (part.type === "mention" && part.isImage && part.imageData) {
      referenced.add(part.imageData);
      shots.push({
        src: part.imageData,
        alt: part.path || `图片 ${shots.length + 1}`,
      });
      return null;
    }
    if (part.issueId) {
      return (
        <ContextTag
          key={index}
          name={part.fileName || part.issueId}
          path={part.issueId}
          tooltip={part.fileName || part.issueId}
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
    return (
      <span key={index} className="assistant-user-text">
        {part.content}
      </span>
    );
  });
  for (const url of urls) {
    shots.push({ src: url, alt: `图片 ${shots.length + 1}` });
  }
  line.images
    ?.filter((img) => !referenced.has(img.data))
    .forEach((img) => {
      shots.push({ src: img.data, alt: `图片 ${shots.length + 1}` });
    });
  const hasBody = body.some(Boolean);
  const gallery = shots.map((shot) => ({ url: shot.src, alt: shot.alt }));
  const source = sourceApp(line.app);
  return (
    <div className="assistant-bubble-row assistant-bubble-row-user">
      {source ? <div className="assistant-bubble-source">{source}</div> : null}
      <div className="assistant-bubble assistant-bubble-user">
        <div className="assistant-user-content">
          {hasBody ? <div className="assistant-user-body">{body}</div> : null}
          {shots.length > 0 ? (
            <div className="assistant-user-images">
              {shots.map((shot, index) => (
                <UserShot
                  key={`${index}:${shot.alt}`}
                  src={shot.src}
                  alt={shot.alt}
                  gallery={gallery}
                  index={index}
                  onPreviewImage={onPreviewImage}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <BubbleTime at={line.at} />
    </div>
  );
}

function fileBaseName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
}

function AssistantFileChip({
  path,
  closed,
  onOpen,
}: {
  path: string;
  closed: boolean;
  onOpen: (path: string) => void;
}) {
  const name = fileBaseName(path);
  const html = isHtmlPreviewPath(path);
  if (closed) {
    return (
      <span className="assistant-file-chip assistant-file-chip-closed" title={path}>
        <FileIcon name={name} className="assistant-file-chip-icon" />
        <span className="assistant-file-chip-name">{name}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="assistant-file-chip"
      data-testid="assistant-file-chip"
      data-path={path}
      title={path}
      aria-label={html ? `在内置浏览器中打开 ${name}` : `打开 ${name}`}
      onClick={() => onOpen(path)}
    >
      <FileIcon name={name} className="assistant-file-chip-icon" />
      <span className="assistant-file-chip-name">{name}</span>
    </button>
  );
}

function AssistantBubbleBody({
  line,
  closedFilePaths,
  onLinkClick,
  onOpenAttachment,
  onSelectIssue,
  onPreviewImage,
}: {
  line: AssistantLine;
  closedFilePaths: ReadonlySet<string>;
  onLinkClick: (event: MouseEvent) => void;
  onOpenAttachment: (path: string) => void;
  onSelectIssue?: (issueId: string) => void;
  onPreviewImage: (
    src: string,
    alt: string,
    gallery: PreviewImage[],
    index: number,
  ) => void;
}) {
  const { text, urls } = channelImageUrls(line.message);
  const shots = [...urls, ...(line.images ?? []).map((img) => img.data)];
  const gallery = shots.map((src, index) => ({ url: src, alt: `图片 ${index + 1}` }));
  const parts = parseMentions(text).filter(
    (part) => part.issueId || part.content.trim(),
  );
  return (
    <>
      {parts.map((part, index) => {
        if (part.issueId) {
          return (
            <ContextTag
              key={`${line.id}:issue:${index}`}
              name={part.fileName || part.issueId}
              path={part.issueId}
              tooltip={part.fileName || part.issueId}
            />
          );
        }
        const { text: body, files } = splitAssistantFileLines(part.content);
        return (
          <div key={`${line.id}:text:${index}`}>
            {body.trim() ? (
              <MarkdownView
                className="message-content markdown-content"
                onClick={(event) => {
                  const quote = (event.target as HTMLElement).closest(
                    "blockquote.assistant-issue-quote",
                  );
                  if (quote && line.issueId && onSelectIssue) {
                    event.preventDefault();
                    onSelectIssue(line.issueId);
                    return;
                  }
                  onLinkClick(event);
                }}
                html={withIssueQuote(
                  markdownHtml(body, closedFilePaths),
                  line.issueId,
                )}
              />
            ) : null}
            {files.length > 0 ? (
              <div className="assistant-file-list">
                {files.map((path) => (
                  <AssistantFileChip
                    key={path}
                    path={path}
                    closed={closedFilePaths.has(path)}
                    onOpen={onOpenAttachment}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {shots.length > 0 ? (
        <div className="assistant-user-images">
          {shots.map((src, index) => (
            <UserShot
              key={`${line.id}:${index}`}
              src={src}
              alt={`图片 ${index + 1}`}
              gallery={gallery}
              index={index}
              onPreviewImage={onPreviewImage}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export const AssistantPage: React.FC<{
  api: AssistantPageApi;
  vscode?: VsCodeApi;
  showPanelToggle?: boolean;
  onToggleDock?: () => void;
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
  onOpenUrl?: (url: string) => void;
  /** 浏览器元素评论、diff 评论写进这个输入框。 */
  inputRef?: Ref<MessageInputHandle>;
  /** 输入框 @ 可以点名这些进行中的 Issue。 */
  mentionIssues?: Array<{ id: string; title: string }>;
  /** 没有对话记录时替换「还没有消息」。有记录时不渲染。 */
  emptyState?: ReactNode;
  /** 桌面 Muse Bot 已在旁边挂上待处理列表时，不再在消息列里重复一份。 */
  hideQueue?: boolean;
  /**
   * 桌面标签栏上的挂点。传入后「对话 / 轨迹」画到这里，
   * 不再在消息列顶上另起一行「Muse Bot」标题。
   */
  viewSwitchHost?: HTMLElement | null;
  /** Muse Bot 轨迹页要收起右上角的待处理和事项。 */
  onViewModeChange?: (mode: "chat" | "transcript") => void;
  /** 分栏时左侧输入框聚焦，用来清掉离开主页期间攒下的未读和通知。 */
  onComposerFocusChange?: (focused: boolean) => void;
  /** 点击回复里的事项标题，切到这条 Issue。 */
  onSelectIssue?: (issueId: string) => void;
}> = ({
  api,
  vscode = noopHost,
  showPanelToggle = false,
  onToggleDock,
  onOpenFile,
  onOpenUrl,
  inputRef,
  mentionIssues,
  emptyState,
  hideQueue = false,
  viewSwitchHost,
  onViewModeChange,
  onComposerFocusChange,
  onSelectIssue,
}) => {
  const [lines, setLines] = useState<AssistantLine[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "transcript">("chat");
  useEffect(() => {
    onViewModeChange?.(mode);
  }, [mode, onViewModeChange]);
  useEffect(() => () => onComposerFocusChange?.(false), [onComposerFocusChange]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentHasMore, setAgentHasMore] = useState(false);
  const agentMessagesRef = useRef(agentMessages);
  agentMessagesRef.current = agentMessages;
  const agentHasMoreRef = useRef(false);
  const agentSessionRef = useRef<string | undefined>(undefined);
  const olderLoadedRef = useRef(false);
  const loadingAgentOlder = useRef(false);
  const [agentWorkdir, setAgentWorkdir] = useState<string | undefined>();
  const [openableFilePaths, setOpenableFilePaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [answeredFilePaths, setAnsweredFilePaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const probedFilePaths = useRef<Set<string>>(new Set());
  const [agentError, setAgentError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [queue, setQueue] = useState<AssistantQueueItem[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const atTail = useRef(true);
  const loadingOlder = useRef(false);
  const previewClosers = useRef<Set<() => void>>(new Set());
  useEffect(() => {
    const closers = previewClosers.current;
    return () => {
      for (const close of closers) close();
      closers.clear();
    };
  }, []);
  const previewImage = useCallback((
    src: string,
    alt: string,
    gallery?: PreviewImage[],
    index?: number,
  ) => {
    previewClosers.current.add(openImagePreview(src, alt, gallery, index));
  }, []);

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

  const filePathKey = lines
    .flatMap((line) => collectAssistantFilePaths(line.message))
    .join("\n");

  const closedFilePaths = useMemo(() => {
    const closed = new Set<string>();
    if (!agentWorkdir || !filePathKey) return closed;
    for (const filePath of new Set(filePathKey.split("\n"))) {
      const key = `${agentWorkdir}\0${filePath}`;
      if (openableFilePaths.has(key)) continue;
      // A full path is a file the user can open now. Hide it only after the
      // host says that click would not open anything.
      if (keepsFileLinkUntilProbe(filePath) && !answeredFilePaths.has(key)) continue;
      closed.add(filePath);
    }
    return closed;
  }, [agentWorkdir, filePathKey, openableFilePaths, answeredFilePaths]);

  useEffect(() => {
    probedFilePaths.current = new Set();
    setOpenableFilePaths(new Set());
    setAnsweredFilePaths(new Set());
  }, [agentWorkdir]);

  useEffect(() => {
    if (!agentWorkdir || !filePathKey) return;
    const pending = [...new Set(filePathKey.split("\n"))].filter(
      (filePath) => !probedFilePaths.current.has(`${agentWorkdir}\0${filePath}`),
    );
    if (pending.length === 0) return;
    const requestId = `probe-${Date.now()}-${pending.length}`;
    let cancelled = false;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        command?: string;
        requestId?: string;
        openable?: unknown;
      } | null;
      if (!data || data.command !== "probeFileLinksResult" || data.requestId !== requestId) {
        return;
      }
      if (cancelled) return;
      const openable = new Set(
        Array.isArray(data.openable)
          ? data.openable.filter((item): item is string => typeof item === "string")
          : [],
      );
      const answered = pending.map((filePath) => `${agentWorkdir}\0${filePath}`);
      for (const key of answered) probedFilePaths.current.add(key);
      setAnsweredFilePaths((prev) => {
        const next = new Set(prev);
        for (const key of answered) next.add(key);
        return next;
      });
      const found = pending.filter((filePath) => openable.has(filePath));
      if (found.length === 0) return;
      setOpenableFilePaths((prev) => {
        const next = new Set(prev);
        for (const filePath of found) next.add(`${agentWorkdir}\0${filePath}`);
        return next;
      });
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({
      command: "probeFileLinks",
      requestId,
      workdir: agentWorkdir,
      paths: pending,
    });
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [agentWorkdir, filePathKey, vscode]);

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
      if (typeof info.compacting === "boolean") setCompacting(info.compacting);
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
          if (agentSessionRef.current !== info.sessionId) {
            agentSessionRef.current = info.sessionId;
            olderLoadedRef.current = false;
          }
          const page = await api.getMessages!(info.sessionId);
          if (cancelled) return;
          if (typeof info.compacting === "boolean") setCompacting(info.compacting);
          setAgentWorkdir(info.workdir);
          const incoming = materializeMessageImages(
            page.messages as AgentMessage[],
          ) as AgentMessage[];
          setAgentMessages((prev) =>
            mergeTranscriptTail(prev, incoming, olderLoadedRef.current),
          );
          if (!olderLoadedRef.current) {
            const hasMore = Boolean(page.hasMore);
            agentHasMoreRef.current = hasMore;
            setAgentHasMore(hasMore);
          }
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

  const loadOlderAgent = useCallback(async () => {
    const sessionId = agentSessionRef.current;
    const before = agentMessagesRef.current[0]?.id;
    if (
      !sessionId ||
      !before ||
      !agentHasMoreRef.current ||
      loadingAgentOlder.current ||
      !api.getMessages
    ) {
      return;
    }
    loadingAgentOlder.current = true;
    try {
      const page = await api.getMessages(sessionId, { before, limit: 40 });
      const older = materializeMessageImages(
        page.messages as AgentMessage[],
      ) as AgentMessage[];
      olderLoadedRef.current = true;
      const hasMore = Boolean(page.hasMore);
      agentHasMoreRef.current = hasMore;
      setAgentHasMore(hasMore);
      setAgentMessages((prev) => {
        const ids = new Set(prev.map((message) => message.id));
        return [...older.filter((message) => message.id && !ids.has(message.id)), ...prev];
      });
      setAgentError(null);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingAgentOlder.current = false;
    }
  }, [api]);

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
  }, [lines, working, compacting]);

  const resetTranscript = useCallback(() => {
    olderLoadedRef.current = false;
    agentHasMoreRef.current = false;
    setLines([]);
    setHasMore(false);
    setAgentMessages([]);
    setAgentHasMore(false);
    setError(null);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        command?: string;
        line?: unknown;
        working?: boolean;
        compacting?: boolean;
        items?: unknown;
      };
      if (data?.command === "assistant:queue" && Array.isArray(data.items)) {
        setQueue(data.items.flatMap((item) => asQueueItem(item) ?? []));
        return;
      }
      if (data?.command === "assistant:status") {
        setWorking(Boolean(data.working));
        if (typeof data.compacting === "boolean") setCompacting(data.compacting);
        else if (!data.working) setCompacting(false);
        if (data.working || data.compacting) atTail.current = true;
        return;
      }
      if (data?.command === "assistant:cleared") {
        resetTranscript();
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
  }, [appendLine, resetTranscript]);

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
      if (closedFilePaths.has(target.path)) return;
      const resolved = resolveWorkspaceFilePath(target.path, agentWorkdir);
      if (isHtmlPreviewPath(target.path)) {
        onOpenUrl?.(pathToFileUrl(resolved));
        return;
      }
      onOpenFile?.(resolved, target.startLine, target.endLine);
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
    if (!message && attached.length === 0) return;
    if (/^\/clear(?:\s|$)/.test(message)) {
      if (working || !api.clearAssistantMessages) return;
      setError(null);
      try {
        await api.clearAssistantMessages();
        resetTranscript();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (!detail.includes("409")) setError(detail);
      }
      return;
    }
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
    }
  }

  const viewSwitch = (
    <div className="assistant-header-actions">
      <div
        className="assistant-view-switch"
        role="group"
        aria-label="查看内容"
        data-mode={mode}
      >
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
          轨迹
        </button>
      </div>
      {showPanelToggle && onToggleDock ? (
        <PanelToggleControl onToggleDock={onToggleDock} />
      ) : null}
    </div>
  );

  return (
    <div className="assistant-page">
      {viewSwitchHost !== undefined ? (
        viewSwitchHost ? createPortal(viewSwitch, viewSwitchHost) : null
      ) : (
        <header className="assistant-header">
          <div className="assistant-header-title">灵光</div>
          {viewSwitch}
        </header>
      )}
      {hideQueue ? null : (
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
                  {item.active ? (compacting ? "压缩中" : "处理中") : "等待"}
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
      )}
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
              isCompacting={compacting}
              hasOlderMessages={agentHasMore}
              onLoadOlder={() => {
                void loadOlderAgent();
              }}
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
          {lines.length === 0 ? (
            emptyState ?? <p className="assistant-empty">还没有消息</p>
          ) : null}
          <div
            ref={virtualizer.containerRef}
            className="virtual-spacer"
          />
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const line = lines[virtualRow.index];
            if (!line) return null;
            const source = sourceApp(line.app);
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
                    onPreviewImage={previewImage}
                  />
                ) : (
                  <div className="assistant-bubble-row assistant-bubble-row-assistant">
                    {source ? (
                      <div className="assistant-bubble-source">{source}</div>
                    ) : null}
                    <div className="assistant-bubble assistant-bubble-assistant">
                      <AssistantBubbleBody
                        line={line}
                        closedFilePaths={closedFilePaths}
                        onLinkClick={handleLinkClick}
                        onOpenAttachment={openHref}
                        onSelectIssue={onSelectIssue}
                        onPreviewImage={previewImage}
                      />
                    </div>
                    <BubbleTime at={line.at} />
                  </div>
                )}
              </div>
            );
          })}
          {compacting ? (
            <div className="message-list-status-hint" data-testid="compaction-hint">
              <span className="message-list-status-dot" aria-hidden="true" />
              <span className="message-list-status-label">正在压缩对话…</span>
            </div>
          ) : working ? (
            <div className="message-list-status-hint" data-testid="thinking-hint">
              <span className="message-list-status-dot" aria-hidden="true" />
              <span className="message-list-status-label text-shimmer">工作中....</span>
            </div>
          ) : null}
        </div>
      </div>
      {error ? <p className="assistant-error">{error}</p> : null}
      <div
        className="assistant-composer"
        onFocus={() => onComposerFocusChange?.(true)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          onComposerFocusChange?.(false);
        }}
      >
        <AssistantComposer
          vscode={vscode}
          workdir={agentWorkdir}
          mentionIssues={mentionIssues}
          inputRef={inputRef}
          onSend={(text, images) => {
            void send(text, images);
          }}
        />
      </div>
      </>
      )}
    </div>
  );
};
