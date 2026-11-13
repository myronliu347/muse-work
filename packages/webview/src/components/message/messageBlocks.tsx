import React from "react";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  AGENT_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  LSP_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "@muse-work/agent/constants";
import type { ImageBlock, Message as MessageType, TaskNotificationBlock, ToolBlock, VsCodeApi } from "../../types";
import { resolveImageSrc } from "../../utils/resolveImageSrc";
import { DiffViewer } from "./DiffViewer";
import type { PreviewImage } from "./imagePreview";
import { ResolvedImage, useResolvedImageSrc } from "./ResolvedImage";
import { ToolLine } from "./ToolActivityGroup";
import { toolHasDetail, toolOpenTarget, toolPresentation } from "./toolActivity";
import { WriteToolPreview } from "./WriteToolPreview";

function UserImageThumb({
  imageUrl,
  name,
  gallery,
  galleryIndex,
  onPreview,
}: {
  imageUrl: string;
  name: string;
  gallery: PreviewImage[];
  galleryIndex: number;
  onPreview: (
    src: string,
    alt: string,
    gallery: PreviewImage[],
    index: number,
  ) => void;
}) {
  const resolved = useResolvedImageSrc(imageUrl);
  return (
    <button
      type="button"
      className="user-image-thumb"
      title={name}
      disabled={!resolved}
      onClick={() => {
        if (!resolved) return;
        // Resolution is synchronous, so the gallery opens in the same tick.
        onPreview(
          resolved,
          name,
          gallery.map((item) => ({ ...item, url: resolveImageSrc(item.url) })),
          galleryIndex,
        );
      }}
    >
      <ResolvedImage src={imageUrl} alt={name} draggable={false} />
    </button>
  );
}

/** A pasted image whose upload file is gone. No `<img>` src is rendered. */
function MissingImagePlaceholder({ count }: { count: number }) {
  return (
    <div
      className="user-image-missing"
      data-testid="user-image-missing"
      title={count > 1 ? `${count} 张图片已清理` : "图片已清理"}
    >
      <span>图片已清理</span>
    </div>
  );
}

export function renderToolActivity(options: {
  toolBlock: ToolBlock;
  index: number;
  vscode: VsCodeApi;
  workdir?: string;
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  onOpenAgentTranscript?: (toolBlock: ToolBlock) => void;
}): React.ReactNode {
  const { toolBlock: rootTool, index: rootIndex, vscode, workdir, onOpenFile, onOpenAgentTranscript } = options;

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
const isToolActive = (stage?: string) =>
  stage === "start" || stage === "running" || stage === "streaming";

const openToolFile = (toolBlock: ToolBlock) => {
  const target = toolOpenTarget(toolBlock);
  if (!target) return;
  onOpenFile(target.path, target.startLine, target.endLine);
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
          vscode={vscode}
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
  const file = toolOpenTarget(toolBlock);
  const fileName = file?.path.split(/[/\\]/).filter(Boolean).pop();
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
      fileName={fileName}
      onOpenFile={file ? () => openToolFile(toolBlock) : undefined}
      onActivate={
        toolBlock.name === AGENT_TOOL_NAME
          ? () => onOpenAgentTranscript?.(toolBlock)
          : undefined
      }
    />
  );
};
  return renderActivityTool(rootTool, rootIndex);
}

export function renderMessageImage(options: {
  message: MessageType;
  imageBlock: ImageBlock;
  index: number;
  onPreview: (
    url: string,
    name: string,
    gallery?: PreviewImage[],
    index?: number,
  ) => void;
}): React.ReactNode {
  const { message, imageBlock, index, onPreview } = options;
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
  const handleImagePreview = onPreview;

const renderImageBlock = (imageBlock: ImageBlock, index: number) => {
  const imageUrls = imageBlock.imageUrls ?? [];
  const missingCount = imageBlock.missingImageCount ?? 0;
  if (imageUrls.length === 0 && missingCount === 0) {
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
        {imageUrls.map((imageUrl, imgIndex) => {
          if (!imageUrl) return null;
          const name = `图片 ${imgIndex + 1}`;
          return (
            <UserImageThumb
              key={`img-${index}-${imgIndex}`}
              imageUrl={imageUrl}
              name={name}
              gallery={gallery}
              galleryIndex={offset + imgIndex}
              onPreview={handleImagePreview}
            />
          );
        })}
        {missingCount > 0 ? (
          <MissingImagePlaceholder count={missingCount} />
        ) : null}
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
      {imageUrls.map((imageUrl, imgIndex) => (
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
      {missingCount > 0 ? (
        <div className="image-item-message image-item-message--missing">
          <div className="image-icon">
            <span className="image-type">IMG</span>
          </div>
          <div className="image-info">
            <span className="image-name">图片已清理</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
  return renderImageBlock(imageBlock, index);
}

export function renderTaskNotificationBlock(
  block: TaskNotificationBlock,
  index: number,
): React.ReactNode {

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

}
