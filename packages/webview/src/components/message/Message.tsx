import React, { useEffect, useRef } from "react";
import { ContextTag } from "../shared/ContextTag";
import { parseMentions } from "../../utils/messageUtils";
import { decodeFileHref } from "../../utils/filePathDisplay";
import { isLocalhostUrl } from "../../utils/isLocalhostUrl";
import { BangBlock } from "./BangBlock";
import { Tooltip } from "../shared/Tooltip";
import { parseMarkdownWithMermaid } from "./messageMarkdown";
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
import { MermaidRenderer } from "./MermaidRenderer";
import { ReasoningBlockView } from "./ReasoningBlockView";
import { CompactBlockView } from "./CompactBlockView";
import { openImagePreview, type PreviewImage } from "./imagePreview";
import {
  renderMessageImage,
  renderTaskNotificationBlock,
  renderToolActivity,
} from "./messageBlocks";
import { MarkdownView } from "./MarkdownView";
import {
  ToolActivityGroup,
  ThoughtLine,
  ToolLine,
} from "./ToolActivityGroup";
import {
  activityGroupDefaultOpen,
  bangLineLabel,
  segmentAssistantBlocks,
  summarizeActivity,
} from "./toolActivity";
import "../../styles/Message.css";

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


    // Dot color for text/reasoning blocks: yellow while streaming, green once done.
    const getStageColor = (stage?: "streaming" | "end") =>
      stage === "streaming"
        ? "var(--amber-11)"
        : "var(--green-11)";

    const renderActivityTool = (toolBlock: ToolBlock, index: number) =>
      renderToolActivity({
        toolBlock,
        index,
        vscode: props.vscode,
        workdir,
        onOpenFile: openFile,
        onOpenAgentTranscript,
      });


    const renderImageBlock = (imageBlock: ImageBlock, index: number) =>
      renderMessageImage({
        message,
        imageBlock,
        index,
        onPreview: handleImagePreview,
      });


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
    ) => renderTaskNotificationBlock(block, index);


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
        return (
          <ToolActivityGroup
            key={`activity-${segment.indexes[0]}`}
            label={summary.label}
            additions={summary.additions}
            deletions={summary.deletions}
            defaultOpen={activityGroupDefaultOpen(
              [{ blocks }],
              segment.indexes.map((blockIndex) => ({
                messageIndex: 0,
                blockIndex,
              })),
            )}
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
