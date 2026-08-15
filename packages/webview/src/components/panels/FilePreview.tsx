import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { FileViewState } from "../../types";
import { useMuseTheme } from "../../ui/theme";
import { displayFilePath } from "../../utils/filePathDisplay";
import { highlightCode } from "../../utils/shikiHighlighter";

const HIGHLIGHT_LINE_HEIGHT = 20;

const isMarkdownPath = (path: string) =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

const sanitizeFileMarkdown = (html: string): string => {
  const clean = DOMPurify.sanitize(html, {
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
      "span",
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
  });
  return typeof clean === "string" ? clean : "";
};

const renderFileMarkdown = (content: string): string => {
  const raw = marked.parse(content, { gfm: true, breaks: true });
  return sanitizeFileMarkdown(typeof raw === "string" ? raw : content);
};

export type FilePreviewProps = {
  fileView: FileViewState;
  workdir?: string;
  onRevealInFinder?: (path: string) => void;
  markdownMode?: "preview" | "source";
};

export const FilePreview: React.FC<FilePreviewProps> = ({
  fileView,
  workdir,
  onRevealInFinder,
  markdownMode = "preview",
}) => {
  const { effective } = useMuseTheme();
  const dark = effective === "dark";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const relativePath = useMemo(
    () => displayFilePath(fileView.path, workdir),
    [fileView.path, workdir],
  );
  const markdown = fileView.content ? isMarkdownPath(fileView.path) : false;
  const showSource = markdown && markdownMode === "source";
  const showCode =
    !!fileView.content &&
    !fileView.error &&
    !fileView.unsupported &&
    (!markdown || showSource);

  useEffect(() => {
    if (!showCode || !fileView.content) {
      setLines(null);
      return;
    }
    let cancelled = false;
    void highlightCode(fileView.content, fileView.path, dark).then((next) => {
      if (!cancelled) setLines(next);
    });
    return () => {
      cancelled = true;
    };
  }, [showCode, fileView.content, fileView.path, dark]);

  useEffect(() => {
    const start = fileView.startLine;
    const el = scrollRef.current;
    if (!start || !el || !lines) return;
    el.scrollTop = Math.max(
      0,
      (start - 1) * HIGHLIGHT_LINE_HEIGHT - HIGHLIGHT_LINE_HEIGHT * 1.5,
    );
  }, [fileView.path, fileView.startLine, lines]);

  if (fileView.error) {
    return (
      <div className="file-pane-status" ref={scrollRef}>
        <i className="codicon codicon-error file-pane-status-icon" />
        <span>{fileView.error}</span>
      </div>
    );
  }

  if (fileView.unsupported) {
    const label =
      fileView.unsupported === "too-large"
        ? "文件超过 1MB，暂不支持在面板中预览"
        : "二进制文件暂不支持在面板中预览";
    return (
      <div className="file-pane-unsupported" data-testid="file-unsupported">
        <i className="codicon codicon-file-binary" style={{ fontSize: 28 }} />
        <span>{label}</span>
        {fileView.host === "local" && onRevealInFinder && (
          <button
            className="preview-pane-button"
            data-testid="file-reveal-finder"
            type="button"
            onClick={() => onRevealInFinder(fileView.path)}
          >
            在 Finder 中显示
          </button>
        )}
      </div>
    );
  }

  if (fileView.imageBase64) {
    return (
      <div className="file-pane-preview-body" ref={scrollRef}>
        <img
          className="file-pane-image"
          src={fileView.imageBase64}
          alt={relativePath || fileView.path}
        />
      </div>
    );
  }

  if (!fileView.content) {
    return (
      <div className="desktop-panel-placeholder">
        <i className="codicon codicon-loading codicon-modifier-spin" />
        <span>正在读取文件…</span>
      </div>
    );
  }

  return (
    <div className="file-pane-preview-body" ref={scrollRef}>
      {markdown && markdownMode === "preview" && (
        <div
          className="message-content markdown-content file-pane-markdown"
          dangerouslySetInnerHTML={{
            __html: renderFileMarkdown(fileView.content),
          }}
        />
      )}
      {showCode && lines && (
        <div className="file-pane-code">
          {fileView.truncated && fileView.totalLines !== undefined && (
            <div className="file-pane-truncated-hint">
              文件共 {fileView.totalLines} 行，仅显示前 {lines.length} 行
            </div>
          )}
          {lines.map((line, i) => {
            const lineNo = i + 1;
            const active =
              fileView.startLine !== undefined &&
              lineNo >= fileView.startLine &&
              (fileView.endLine === undefined ||
                lineNo <= fileView.endLine);
            return (
              <div
                key={i}
                className={`file-pane-line${active ? " file-pane-line--active" : ""}`}
              >
                <span className="file-pane-line-no">{lineNo}</span>
                <span
                  className="file-pane-line-code"
                  dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }}
                />
              </div>
            );
          })}
          {fileView.truncated && fileView.totalLines === undefined && (
            <div className="file-pane-truncated-hint">
              文件较大，内容已截断
            </div>
          )}
        </div>
      )}
      {showCode && !lines && (
        <div className="desktop-panel-placeholder">
          <i className="codicon codicon-loading codicon-modifier-spin" />
          <span>正在高亮…</span>
        </div>
      )}
    </div>
  );
};

export default FilePreview;
