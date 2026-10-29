import React, { useEffect, useRef } from "react";
import { ContextTag } from "../shared/ContextTag";
import { parseMentions, toRelativePath, linkifyFilePaths } from "../../utils/messageUtils";
import { decodeFileHref } from "../../utils/filePathDisplay";
import { isLocalhostUrl } from "../../utils/isLocalhostUrl";
import { marked } from "marked";
import { BangBlock } from "./BangBlock";
import { Tooltip } from "../shared/Tooltip";
import DOMPurify from "dompurify";
import {
  BASH_TOOL_NAME,
  LSP_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  READ_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  AGENT_TOOL_NAME,
} from "@muse-work/agent/constants";
import type {
  Message as MessageType,
  MessageProps,
  ToolBlock,
  ImageBlock,
  TaskNotificationBlock,
  ReasoningBlock,
  CompactBlock,
  MessageBlock,
} from "../../types";
import { DiffViewer } from "./DiffViewer";
import { MermaidRenderer } from "./MermaidRenderer";
import { ReasoningBlockView } from "./ReasoningBlockView";
import { CompactBlockView } from "./CompactBlockView";
import { WriteToolPreview } from "./WriteToolPreview";
import { openImagePreview, type PreviewImage } from "./imagePreview";
import { MarkdownView } from "./MarkdownView";
import {
  ToolActivityGroup,
  ThoughtLine,
  ToolLine,
} from "./ToolActivityGroup";
import {
  bangLineLabel,
  isActivityLive,
  segmentAssistantBlocks,
  summarizeActivity,
  toolHasDetail,
  toolPresentation,
} from "./toolActivity";
import "../../styles/Message.css";

// Configure marked for VS Code webview context
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    listitem(text: string, task: boolean, checked: boolean) {
      if (task) {
        return `<li class="task-list-item${checked ? " checked" : ""}">${text}</li>`;
      }
      return `<li>${text}</li>`;
    },
  },
});

// Interface for parsed markdown content that may contain mermaid diagrams
interface ParsedMarkdownContent {
  elements: Array<{
    type: "html" | "mermaid";
    content: string;
    id?: string;
  }>;
}

// Parse markdown content and extract mermaid blocks
const parseMarkdownWithMermaid = (content: string): ParsedMarkdownContent => {
  if (!content || content.trim() === "") {
    return { elements: [] };
  }

  const elements: Array<{
    type: "html" | "mermaid";
    content: string;
    id?: string;
  }> = [];

  // Split content by mermaid blocks
  const parts = content.split(/(```mermaid\n[\s\S]*?\n```)/g);

  let mermaidIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.match(/^```mermaid\n[\s\S]*?\n```$/)) {
      // This is a mermaid block
      const mermaidContent = part
        .replace(/^```mermaid\n/, "")
        .replace(/\n```$/, "")
        .trim();
      elements.push({
        type: "mermaid",
        content: mermaidContent,
        id: `mermaid-${mermaidIndex++}`,
      });
    } else if (part.trim()) {
      // This is regular markdown content
      const html = marked.parse(linkifyFilePaths(part));
      const sanitizedHtml = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "strong",
          "b",
          "em",
          "i",
          "code",
          "pre",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ul",
          "ol",
          "li",
          "a",
          "blockquote",
          "hr",
          "img",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "del",
          "input",
        ],
        ALLOWED_ATTR: [
          "href",
          "title",
          "align",
          "type",
          "checked",
          "disabled",
          "class",
          "src",
          "alt",
        ],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: [],
        FORBID_TAGS: [],
      });

      if (typeof sanitizedHtml === "string" && sanitizedHtml.trim()) {
        elements.push({
          type: "html",
          content: sanitizedHtml,
        });
      }
    }
  }

  return { elements };
};

// 与 CLI /rewind 检查点判定（isUserCheckpointMessage）保持一致：后台任务
// 通知与 hook 注入的系统生成消息不作为回滚目标，bang 命令消息也不显示按钮。
const isRewindTargetMessage = (message: MessageType): boolean =>
  message.role === "user" &&
  !message.isMeta &&
  !!message.id &&
  !message.blocks.some((b) => b.type === "bang") &&
  !message.blocks.some((b) => b.type === "task_notification") &&
  !message.blocks.some((b) => b.type === "text" && b.source === "hook");

// 系统注入消息（server 以 <system-inject> 标记包裹）。
// 命中时返回标记内内容（去标记），否则 null。
function getSystemInjectContent(message: MessageType): string | null {
  for (const block of message.blocks ?? []) {
    if (block.type !== "text") continue;
    const content = block.content ?? "";
    const match = content.match(/^<system-inject>([\s\S]*)<\/system-inject>$/);
    if (match) return match[1];
  }
  return null;
}

export const Message: React.FC<MessageProps> = React.memo(
  (props: MessageProps) => {
    const {
      message,
      isQueued = false,
      onRewindToMessage,
      workdir,
      blockRenderMode = "all",
      finalTextBlockIndex,
      onOpenAgentTranscript,
      onlyBlockIndex,
      activityItem = false,
    } = props;

    // Desktop routes file opens to its file panel (the host resolves the path,
    // pushing content back). The message chain reaches here via onOpenFile so
    // the outbound message carries the originating paneId (postToHost in
    // ChatApp).
    const openFile = (path: string, startLine?: number, endLine?: number) => {
      if (props.onOpenFile) {
        props.onOpenFile(path, startLine, endLine);
      }
    };

    const getMessageClassName = () => {
      const classes = ["message"];

      const hasBangBlock = message.blocks?.some((b) => b.type === "bang");

      if (message.role === "user") {
        if (!hasBangBlock) {
          classes.push("user");
        }
        if (getSystemInjectContent(message) !== null) {
          classes.push("system-inject");
        }
        if (isQueued) {
          classes.push("queued");
        }
      } else if (message.role === "assistant") {
        classes.push("assistant");
      }

      return classes.join(" ");
    };

    // Open image-preview modals, tracked so a mid-preview unmount (session
    // switch / clear) releases both the document keydown listener and the
    // modal DOM (which pins the image data via its closure) instead of leaking
    // them until the next explicit close.
    const previewClosersRef = useRef<Set<() => void>>(new Set());
    useEffect(() => {
      const closers = previewClosersRef.current;
      return () => {
        for (const close of closers) close();
        closers.clear();
      };
    }, []);

    const handleImagePreview = (
      url: string,
      name: string,
      gallery?: PreviewImage[],
      index?: number,
    ) => {
      const close = openImagePreview(url, name, gallery, index);
      previewClosersRef.current.add(close);
    };

    const imageGallery = (): PreviewImage[] => {
      const images: PreviewImage[] = [];
      for (const block of message.blocks ?? []) {
        if (block.type !== "image" || !block.imageUrls) continue;
        for (const imageUrl of block.imageUrls) {
          images.push({ url: imageUrl, alt: `图片 ${images.length + 1}` });
        }
      }
      return images;
    };

    const getAttachedImages = () => {
      const images: Array<{ data: string; filename?: string }> = [];
      message.blocks?.forEach((block) => {
        if (block.type === "image" && block.imageUrls) {
          block.imageUrls.forEach((url) => {
            images.push({ data: url, filename: `图片 ${images.length + 1}` });
          });
        } else if (block.type === "tool" && block.images) {
          block.images.forEach((img) => {
            images.push({
              data: img.data,
              filename: `图片 ${images.length + 1}`,
            });
          });
        }
      });
      return images;
    };

    // A href without a URL scheme is a file path link produced by
    // linkifyFilePaths; route it to the file panel instead of the browser.
    const parseFileLink = (href: string) => {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("#")) {
        return null;
      }
      const decoded = decodeFileHref(href);
      const m = decoded.match(/^(.+?):(\d+)(?::(\d+))?$/);
      if (m) {
        return {
          path: m[1],
          startLine: Number(m[2]),
          endLine: m[3] ? Number(m[3]) : undefined,
        };
      }
      return { path: decoded };
    };

    const handleContentClick = (e: React.MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      const fileLink = parseFileLink(href);
      if (fileLink) {
        openFile(fileLink.path, fileLink.startLine, fileLink.endLine);
        return;
      }
      const openInBrowser =
        props.onOpenPreview &&
        (props.openHttpInBrowser ? /^https?:/i.test(href) : isLocalhostUrl(href));
      if (openInBrowser) {
        props.onOpenPreview?.(href);
      } else {
        props.vscode.postMessage({ command: "openExternal", url: href });
      }
    };

    const renderMarkdownContent = (content: string, index: number) => {
      const parsed = parseMarkdownWithMermaid(content);
      return (
        <div
          key={index}
          className="message-content-container"
          onClick={handleContentClick}
        >
          {parsed.elements.map((element, elIndex) =>
            element.type === "mermaid" ? (
              <MermaidRenderer
                key={element.id || `mermaid-${index}-${elIndex}`}
                content={element.content}
              />
            ) : (
              <MarkdownView
                key={`html-${index}-${elIndex}`}
                className="message-content markdown-content"
                html={element.content}
              />
            ),
          )}
        </div>
      );
    };

    const renderBashIO = (toolBlock: ToolBlock) => {
      const stage = toolBlock.stage;

      // Parse the command from parameters
      let command = "";
      let hasValidCommand = false;
      try {
        if (toolBlock.parameters) {
          const params = JSON.parse(toolBlock.parameters);
          command = params.command || "";
          hasValidCommand = !!command;
        }
      } catch {
        // If parsing fails, use compactParams or fallback
        command = toolBlock.compactParams || "";
        hasValidCommand = !!toolBlock.compactParams;
      }

      // Only render bash-specific content if we have a valid command and appropriate stage
      if ((stage === "running" || stage === "end") && hasValidCommand) {
        const result = (toolBlock.result || toolBlock.shortResult || "").trim();

        if (result) {
          // Show both input and output if result is present (even if running)
          return (
            <div className="bash-command-unified">
              <div className="bash-command-input">
                <span className="bash-command">{command}</span>
              </div>
              <div className="bash-command-output">{result}</div>
            </div>
          );
        } else {
          // Show only input if no result yet
          return (
            <div className="bash-command-input">
              <span className="bash-command">{command}</span>
            </div>
          );
        }
      }

      // For all other cases, return null (no additional content)
      return null;
    };

    // Dot color for text/reasoning blocks: yellow while streaming, green once done.
    const getStageColor = (stage?: "streaming" | "end") =>
      stage === "streaming"
        ? "var(--amber-11)"
        : "var(--green-11)";

    const isToolActive = (stage?: string) =>
      stage === "start" || stage === "running" || stage === "streaming";

    const openReadFile = (toolBlock: ToolBlock) => {
      let filePath = "";
      let offset: number | undefined;
      let limit: number | undefined;
      try {
        if (toolBlock.parameters) {
          const params = JSON.parse(toolBlock.parameters);
          filePath = params.file_path || "";
          offset = typeof params.offset === "number" ? params.offset : undefined;
          limit = typeof params.limit === "number" ? params.limit : undefined;
        }
      } catch {
        filePath = "";
      }
      if (!filePath) return;
      openFile(
        filePath,
        offset,
        offset && limit ? offset + limit - 1 : undefined,
      );
    };

    const renderAskUserResult = (toolBlock: ToolBlock) => {
      let answers: Record<string, unknown> = {};
      let isParsed = false;
      try {
        const result = toolBlock.shortResult || toolBlock.result;
        if (typeof result === "string") {
          const trimmed = result.trim();
          if (trimmed.startsWith("{")) {
            const start = trimmed.indexOf("{");
            const end = trimmed.lastIndexOf("}");
            if (start !== -1 && end > start) {
              let parsed = JSON.parse(trimmed.substring(start, end + 1));
              if (
                parsed &&
                typeof parsed === "object" &&
                Object.keys(parsed).length === 1 &&
                parsed.answers &&
                typeof parsed.answers === "object"
              ) {
                parsed = parsed.answers;
              }
              answers = parsed;
              isParsed = true;
            }
          }
        } else if (typeof result === "object" && result !== null) {
          let parsed = result as Record<string, unknown>;
          if (
            Object.keys(parsed).length === 1 &&
            parsed.answers &&
            typeof parsed.answers === "object"
          ) {
            parsed = parsed.answers as Record<string, unknown>;
          }
          answers = parsed;
          isParsed = true;
        }
      } catch {
        isParsed = false;
      }
      const result = toolBlock.shortResult || toolBlock.result;
      if (!result) return null;
      if (!isParsed) {
        return <div className="result-raw">{String(result)}</div>;
      }
      return (
        <>
          {Object.entries(answers).map(([question, answer], aIndex) => (
            <div key={aIndex} className="ask-user-result-item">
              <span className="ask-user-result-q" style={{ whiteSpace: "pre-wrap" }}>
                {question}
              </span>
              <span className="ask-user-result-a" style={{ whiteSpace: "pre-wrap" }}>
                {Array.isArray(answer)
                  ? answer.join(", ")
                  : typeof answer === "object" && answer !== null
                    ? JSON.stringify(answer)
                    : String(answer)}
              </span>
            </div>
          ))}
        </>
      );
    };

    const renderToolDetail = (toolBlock: ToolBlock, index: number) => {
      if (!toolHasDetail(toolBlock)) return null;
      if (toolBlock.name === BASH_TOOL_NAME) {
        const bashContent = renderBashIO(toolBlock);
        if (!bashContent) return null;
        return (
          <div key={index} className="tool-detail">
            {bashContent}
          </div>
        );
      }
      if (toolBlock.name === LSP_TOOL_NAME) {
        const text = (toolBlock.shortResult || toolBlock.result || "").trim();
        if (!text) return null;
        return (
          <div key={index} className="tool-detail">
            <div className="lsp-output">{text}</div>
          </div>
        );
      }
      if (toolBlock.name === WRITE_TOOL_NAME) {
        return (
          <div key={index} className="tool-detail">
            <WriteToolPreview
              toolBlock={toolBlock}
              vscode={props.vscode}
              workdir={workdir}
              hideHeader
            />
          </div>
        );
      }
      if (toolBlock.name === EDIT_TOOL_NAME) {
        return (
          <div key={index} className="tool-detail">
            <DiffViewer toolBlock={toolBlock} />
          </div>
        );
      }
      if (toolBlock.name === ASK_USER_QUESTION_TOOL_NAME) {
        return (
          <div key={index} className="tool-detail">
            {renderAskUserResult(toolBlock)}
          </div>
        );
      }
      if (toolBlock.name === "ExitPlanMode") {
        const result = toolBlock.shortResult || toolBlock.result;
        const resultText =
          typeof result === "string"
            ? result
            : result
              ? JSON.stringify(result)
              : "";
        if (!resultText) return null;
        return (
          <div key={index} className="tool-detail">
            <div className="tool-result-block">
              <div className="result-answer">{resultText}</div>
            </div>
          </div>
        );
      }
      const rawText = (toolBlock.shortResult || toolBlock.result || "").trim();
      if (!rawText) return null;
      return (
        <div key={index} className="tool-detail">
          <div className="tool-result-block">
            <div className="result-raw">
              {rawText.split("\n").map((line, lineIndex) => (
                <div key={lineIndex} className="result-raw-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    };

    const renderActivityTool = (toolBlock: ToolBlock, index: number) => {
      const detail = renderToolDetail(toolBlock, index);
      const presentation = toolPresentation(toolBlock);
      const errorText = toolBlock.error ? String(toolBlock.error) : "";
      return (
        <ToolLine
          key={index}
          label={presentation.label}
          additions={presentation.additions}
          deletions={presentation.deletions}
          shimmer={isToolActive(toolBlock.stage)}
          detail={detail}
          error={errorText}
          testId={
            toolBlock.name === AGENT_TOOL_NAME ? "agent-tool-row" : "tool-line"
          }
          onActivate={
            toolBlock.name === AGENT_TOOL_NAME
              ? () => onOpenAgentTranscript?.(toolBlock)
              : toolBlock.name === READ_TOOL_NAME
                ? () => openReadFile(toolBlock)
                : undefined
          }
        />
      );
    };

    const renderImageBlock = (imageBlock: ImageBlock, index: number) => {
      if (!imageBlock.imageUrls || imageBlock.imageUrls.length === 0) {
        return null;
      }

      // User paste/send path stores data URLs in image blocks (no [imageN] text
      // placeholders). Show real thumbnails; click opens the preview modal.
      if (message.role === "user") {
        const gallery = imageGallery();
        const offset = (message.blocks ?? []).slice(0, index).reduce(
          (count, block) =>
            count + (block.type === "image" ? block.imageUrls?.length ?? 0 : 0),
          0,
        );
        return (
          <div
            key={`image-${index}`}
            className="user-image-block"
            data-testid="user-image-block"
          >
            {imageBlock.imageUrls.map((imageUrl, imgIndex) => {
              const name = `图片 ${imgIndex + 1}`;
              return (
                <button
                  key={`img-${index}-${imgIndex}`}
                  type="button"
                  className="user-image-thumb"
                  title={name}
                  onClick={() => handleImagePreview(imageUrl, name, gallery, offset + imgIndex)}
                >
                  <img src={imageUrl} alt={name} draggable={false} />
                </button>
              );
            })}
          </div>
        );
      }

      const getImageTypeFromUrl = (url: string): string => {
        // Try to determine type from URL extension or default to IMG
        const extension = url.split(".").pop()?.toLowerCase();
        switch (extension) {
          case "png":
            return "PNG";
          case "jpg":
          case "jpeg":
            return "JPG";
          case "gif":
            return "GIF";
          case "webp":
            return "WEBP";
          case "svg":
            return "SVG";
          default:
            return "IMG";
        }
      };

      return (
        <div key={`image-${index}`} className="image-block">
          {imageBlock.imageUrls.map((imageUrl, imgIndex) => (
            <div
              key={`img-${index}-${imgIndex}`}
              className="image-item-message"
            >
              <div className="image-icon">
                <span className="image-type">
                  {getImageTypeFromUrl(imageUrl)}
                </span>
              </div>
              <div className="image-info">
                <span className="image-name">{`Image ${imgIndex + 1}`}</span>
              </div>
            </div>
          ))}
        </div>
      );
    };

    const renderReasoningBlock = (
      reasoningBlock: ReasoningBlock,
      index: number,
    ) => {
      return (
        <ReasoningBlockView
          key={`reasoning-${index}`}
          block={reasoningBlock}
          renderContent={(content) => renderMarkdownContent(content, index)}
        />
      );
    };

    const renderCompactBlock = (compactBlock: CompactBlock, index: number) => {
      return (
        <CompactBlockView
          key={`compact-${index}`}
          block={compactBlock}
          renderContent={(content) => renderMarkdownContent(content, index)}
        />
      );
    };

    const renderTaskNotification = (
      block: TaskNotificationBlock,
      index: number,
    ) => {
      const statusIcon =
        block.status === "completed"
          ? "check"
          : block.status === "failed"
            ? "error"
            : "circle-slash";
      const statusLabel =
        block.status === "completed"
          ? "已完成"
          : block.status === "failed"
            ? "失败"
            : "已终止";
      const statusColor =
        block.status === "completed"
          ? "#3fb950"
          : block.status === "failed"
            ? "#f85149"
            : "#8b949e";
      return (
        <div
          key={`task-notification-${index}`}
          className="task-notification-block"
          style={{
            padding: "8px 12px",
            margin: "4px 0",
            borderRadius: "6px",
            border: `1px solid ${statusColor}40`,
            background: `${statusColor}0d`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <i
              className={`codicon codicon-${statusIcon}`}
              style={{ color: statusColor }}
            ></i>
            <span
              style={{ fontWeight: 500, fontSize: "12px", color: statusColor }}
            >
              {statusLabel}
            </span>
          </div>
          {block.summary && (
            <div style={{ marginTop: "4px", fontSize: "13px" }}>
              {block.summary}
            </div>
          )}
          {block.outputFile && (
            <div
              style={{ marginTop: "4px", fontSize: "12px", color: "#8b949e" }}
            >
              输出: {block.outputFile}
            </div>
          )}
        </div>
      );
    };

    const renderBlock = (block: MessageBlock, index: number) => {
      if (
        typeof finalTextBlockIndex === "number" &&
        blockRenderMode !== "all"
      ) {
        const isFinal = index === finalTextBlockIndex;
        if (blockRenderMode === "finalTextOnly" && !isFinal) return null;
        if (blockRenderMode === "omitFinalText" && isFinal) return null;
      }

      let rendered: React.ReactNode = null;
      let wrap = false;
      let dotColor: string | undefined;

      switch (block.type) {
        case "compact":
          return renderCompactBlock(block, index);
        case "text": {
          const content = block.content || "";
          if (!content.trim()) return null;

          if (message.role === "user") {
            const attachedImages = getAttachedImages();
            const parts = parseMentions(content, attachedImages);

            return (
              <div key={index} className="message-content user-content">
                  {parts.map((part, pIndex) => {
                    if (part.type === "mention") {
                      const onClick = part.isImage
                        ? () => {
                            if (part.imageData) {
                              const attached = getAttachedImages().map((img) => ({
                                url: img.data,
                                alt: img.filename || "image",
                              }));
                              handleImagePreview(
                                part.imageData,
                                part.path || "image",
                                attached,
                                attached.findIndex((img) => img.url === part.imageData),
                              );
                            } else {
                              openFile(part.path || "");
                            }
                          }
                        : undefined;

                      return (
                        <ContextTag
                          key={pIndex}
                          name={
                            part.path
                              ?.replace(/[/\\]$/, "")
                              .split(/[/\\]/)
                              .pop() || ""
                          }
                          path={part.path || ""}
                          isImage={part.isImage}
                          onClick={onClick}
                        />
                      );
                    } else if (part.type === "selection") {
                      const displayName = `${part.fileName} (${part.startLine}-${part.endLine})`;
                      const filePath = part.path || part.fileName || "";
                      return (
                        <ContextTag
                          key={pIndex}
                          name={displayName}
                          path={filePath}
                          onClick={() => {
                            openFile(
                              filePath,
                              part.startLine
                                ? parseInt(part.startLine)
                                : undefined,
                              part.endLine ? parseInt(part.endLine) : undefined,
                            );
                          }}
                        />
                      );
                    } else {
                      return <span key={pIndex}>{part.content}</span>;
                    }
                  })}
              </div>
            );
          }

          rendered = renderMarkdownContent(content, index);
          wrap = true;
          dotColor = getStageColor(block.stage);
          break;
        }
        case "error":
          if (
            block.content === "模型没有产生输出" &&
            message.blocks.some((b) => b.type !== "error")
          ) {
            return null;
          }
          return (
            <div key={index} className="message-content error">
              <pre>{block.content || ""}</pre>
            </div>
          );
        case "tool":
          return renderActivityTool(block as ToolBlock, index);
        case "bang":
          return <BangBlock key={index} block={block} />;
        case "image":
          return renderImageBlock(block as ImageBlock, index);
        case "reasoning":
          rendered = renderReasoningBlock(block, index);
          wrap = true;
          dotColor = getStageColor(block.stage);
          break;
        case "task_notification":
          return renderTaskNotification(block as TaskNotificationBlock, index);
        default:
          return null;
      }

      if (!wrap || rendered === null) return rendered;

      return (
        <div
          key={index}
          className="timeline-row"
          style={
            dotColor
              ? ({ ["--dot-color"]: dotColor } as React.CSSProperties)
              : undefined
          }
        >
          {rendered}
        </div>
      );
    };

    const renderActivityItem = (
      block: MessageBlock | undefined,
      index: number,
    ) => {
      if (!block) return null;
      if (block.type === "reasoning") {
        return (
          <ThoughtLine key={index} block={block}>
            {renderMarkdownContent(block.content || "", index)}
          </ThoughtLine>
        );
      }
      if (block.type === "bang") {
        const detail =
          block.output || block.stage === "running" ? (
            <div className="tool-detail">
              <BangBlock block={block} />
            </div>
          ) : null;
        return (
          <ToolLine
            key={index}
            label={bangLineLabel(block)}
            shimmer={block.stage === "running"}
            detail={detail}
          />
        );
      }
      if (block.type === "tool") return renderActivityTool(block, index);
      return null;
    };

    const renderAssistantSegments = () => {
      const blocks = message.blocks ?? [];
      return segmentAssistantBlocks(blocks).map((segment) => {
        if (segment.type === "single") {
          return renderBlock(blocks[segment.index], segment.index);
        }
        const summary = summarizeActivity(blocks, segment.indexes);
        const live = segment.indexes.some((index) =>
          isActivityLive(blocks[index]),
        );
        return (
          <ToolActivityGroup
            key={`activity-${segment.indexes[0]}`}
            label={summary.label}
            additions={summary.additions}
            deletions={summary.deletions}
            defaultOpen={live}
          >
            {segment.indexes.map((index) =>
              renderActivityItem(blocks[index], index),
            )}
          </ToolActivityGroup>
        );
      });
    };

    const renderUserBubble = () => {
      const indexed = (message.blocks ?? []).map((block, index) => ({
        block,
        index,
      }));
      const ordered = [
        ...indexed.filter((item) => item.block.type === "text"),        ...indexed.filter((item) => item.block.type === "image"),
        ...indexed.filter(
          (item) => item.block.type !== "text" && item.block.type !== "image",
        ),
      ];
      return (
        <div className="user-text-block">
          {ordered.map(({ block, index }) => renderBlock(block, index))}
        </div>
      );
    };

    /** 系统注入消息：居中灰条 + 图标 + 内容（区别于用户气泡）。 */
    const renderSystemInject = (content: string) => (
      <div className="system-inject-bubble" data-testid="system-inject-bubble">
        <div className="system-inject-head">
          <i className="codicon codicon-info" />
          <span>系统</span>
        </div>
        <div className="system-inject-body">{renderMarkdownContent(content, 0)}</div>
      </div>
    );

    const systemInjectContent = getSystemInjectContent(message);

    return (
      <div
        className={getMessageClassName()}
        data-message-id={message.id}
        data-role={message.role}
      >
        {typeof onlyBlockIndex === "number"
          ? activityItem
            ? renderActivityItem(message.blocks?.[onlyBlockIndex], onlyBlockIndex)
            : message.blocks?.[onlyBlockIndex]
              ? renderBlock(message.blocks[onlyBlockIndex], onlyBlockIndex)
              : null
          : message.role === "user" && !message.blocks?.some((b) => b.type === "bang")
            ? systemInjectContent !== null
              ? renderSystemInject(systemInjectContent)
              : renderUserBubble()
            : message.role === "assistant" && blockRenderMode !== "finalTextOnly"
              ? renderAssistantSegments()
              : message.blocks?.map((block, index) => renderBlock(block, index))}
        {isRewindTargetMessage(message) && !isQueued && onRewindToMessage && (
          <div className="message-actions">
            <Tooltip text="回滚到此消息" position="bottom">
              <button
                className="message-action-btn"
                onClick={() => onRewindToMessage?.(message.id!)}
              >
                <i className="codicon codicon-history"></i>
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison for React.memo
    return (
      prev.message === next.message &&
      prev.isQueued === next.isQueued &&
      prev.onRewindToMessage === next.onRewindToMessage &&
      prev.onOpenAgentTranscript === next.onOpenAgentTranscript &&
      prev.onOpenFile === next.onOpenFile &&
      prev.onOpenPreview === next.onOpenPreview &&
      prev.workdir === next.workdir &&
      prev.blockRenderMode === next.blockRenderMode &&
      prev.finalTextBlockIndex === next.finalTextBlockIndex &&
      prev.onlyBlockIndex === next.onlyBlockIndex &&
      prev.activityItem === next.activityItem
    );
  },
);
Message.displayName = "Message";
