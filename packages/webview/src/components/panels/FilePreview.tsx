import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { FileViewState } from "../../types";
import { useMuseTheme } from "../../ui/theme";
import { displayFilePath } from "../../utils/filePathDisplay";
import { highlightCode } from "../../utils/shikiHighlighter";
import {
  findMatches,
  wrapLineMatches,
  type LineMatch,
} from "../../utils/fileSearch";
import {
  encodeFileSelectionClipboard,
  FILE_SELECTION_CLIPBOARD_MIME,
  lineRangeFromFilePreviewSelection,
} from "../../utils/filePanelDnD";

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

/**
 * Resolve a markdown-relative href (e.g. `docs/x.md`, `../y.png`) against the
 * workdir without Node's `path` module. Absolute paths pass through unchanged.
 */
const resolveWorkdirHref = (workdir: string, href: string): string => {
  if (/^[\\/]|^[a-zA-Z]:/.test(href)) return href;
  const parts = workdir.replace(/\\/g, "/").split("/");
  for (const seg of href.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
};

export type FilePreviewProps = {
  fileView: FileViewState;
  workdir?: string;
  onRevealInFinder?: (path: string) => void;
  markdownMode?: "preview" | "source";
  onOpenFile?: (path: string) => void;
  onOpenExternal?: (url: string) => void;
  /** Whether the find-in-file bar is open (owned by the parent pane). */
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  /** Preserved scroll offset for this file, restored when the tab re-activates. */
  savedScrollTop?: number;
  /** Reports scroll changes so the parent can persist per-file positions. */
  onScrollChange?: (scrollTop: number) => void;
};

export const FilePreview: React.FC<FilePreviewProps> = ({
  fileView,
  workdir,
  onRevealInFinder,
  markdownMode = "preview",
  onOpenFile,
  onOpenExternal,
  searchOpen = false,
  onCloseSearch,
  savedScrollTop,
  onScrollChange,
}) => {
  const { effective } = useMuseTheme();
  const dark = effective === "dark";
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
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

  // Plain text lines, aligned with the shiki-highlighted `lines` fragments.
  const plainLines = useMemo(
    () => (fileView.content ?? "").replace(/\n$/, "").split("\n"),
    [fileView.content],
  );
  const matches = useMemo(
    () => findMatches(plainLines, searchQuery.trim()),
    [plainLines, searchQuery],
  );
  const matchesByLine = useMemo(() => {
    const map = new Map<number, LineMatch[]>();
    for (const m of matches) {
      const arr = map.get(m.lineIndex) ?? [];
      arr.push({ start: m.startCol, end: m.endCol });
      map.set(m.lineIndex, arr);
    }
    return map;
  }, [matches]);

  // Reset the search when the file changes.
  useEffect(() => {
    setSearchQuery("");
    setCurrentMatch(0);
  }, [fileView.path]);

  useEffect(() => {
    setCurrentMatch(0);
  }, [searchQuery]);

  // Closing the bar clears the query so stale highlights disappear.
  useEffect(() => {
    if (!searchOpen) setSearchQuery("");
  }, [searchOpen]);

  // Report scroll so the pane can keep per-tab positions. Re-attach when the
  // rendered branch changes which container carries the scroll ref.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onScrollChange) return;
    const onScroll = () => onScrollChange(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [
    onScrollChange,
    fileView.path,
    fileView.error,
    fileView.unsupported,
    fileView.imageBase64,
    showCode,
    markdown,
  ]);

  // Per-tab scroll memory: when this tab re-activates, restore its saved
  // offset once the new file's content actually renders (highlighted lines
  // land asynchronously; the rAF loop waits for them). An explicit startLine
  // jump always wins over the saved position.
  const lastRestoredPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRestoredPathRef.current === fileView.path) return;
    if (fileView.startLine !== undefined) return;
    const saved = savedScrollTop;
    if (saved === undefined || saved <= 0) return;
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      if (!el.isConnected) return;
      const ready = markdown
        ? !!el.querySelector(".file-pane-markdown")
        : el.querySelectorAll(".file-pane-line").length > 0;
      if (!ready) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastRestoredPathRef.current = fileView.path;
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = Math.min(saved, max);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fileView.path, fileView.startLine, savedScrollTop, markdown]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [searchOpen]);

  const total = matches.length;
  const activeIndex =
    total === 0 ? -1 : Math.min(currentMatch, total - 1);

  // Keep the current match visible when navigating.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || activeIndex < 0 || !lines) return;
    const lineIndex = matches[activeIndex].lineIndex;
    el.scrollTop = Math.max(
      0,
      lineIndex * HIGHLIGHT_LINE_HEIGHT - HIGHLIGHT_LINE_HEIGHT * 1.5,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, fileView.path]);

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

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !showCode) return;
    const onCopy = (e: ClipboardEvent) => {
      const codeRoot = root.querySelector(".file-pane-code");
      if (!(codeRoot instanceof HTMLElement)) return;
      const range = lineRangeFromFilePreviewSelection(codeRoot);
      if (!range) return;
      const fileName =
        fileView.path.replace(/\\/g, "/").split("/").pop() || fileView.path;
      const payload = {
        filePath: fileView.path,
        fileName,
        startLine: range.startLine,
        endLine: range.endLine,
        text: range.text,
      };
      e.clipboardData?.setData(
        FILE_SELECTION_CLIPBOARD_MIME,
        encodeFileSelectionClipboard(payload),
      );
      e.clipboardData?.setData("text/plain", range.text);
      e.preventDefault();
    };
    root.addEventListener("copy", onCopy);
    return () => root.removeEventListener("copy", onCopy);
  }, [showCode, fileView.path]);

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
        ? "文件超过 2MB，暂不支持在面板中预览"
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

  // Relative markdown links open the target file in the panel (resolved
  // against the workdir); external URLs go to the system browser. `#` anchors
  // keep their default in-page jump.
  const handleMarkdownClick = (e: React.MouseEvent) => {
    const anchor = (e.target as Element | null)?.closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    e.preventDefault();
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
      onOpenExternal?.(href);
      return;
    }
    const raw = href.split("#")[0];
    if (raw && workdir) onOpenFile?.(resolveWorkdirHref(workdir, raw));
  };

  const stepMatch = (delta: 1 | -1) => {
    if (total === 0) return;
    setCurrentMatch((prev) => (prev + delta + total) % total);
  };

  return (
    <div className="file-pane-preview">
      {searchOpen && showCode && onCloseSearch && (
        <div className="file-pane-search" data-testid="file-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="file-pane-search-input"
            data-testid="file-search-input"
            placeholder="在文件中查找"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCloseSearch();
              }
            }}
          />
          <span
            className="file-pane-search-count"
            data-testid="file-search-count"
          >
            {total === 0 ? "0/0" : `${activeIndex + 1}/${total}`}
          </span>
          <div className="file-pane-search-actions">
            <button
              type="button"
              className="file-pane-search-btn"
              data-testid="file-search-prev"
              title="上一处 (Shift+Enter)"
              aria-label="上一处"
              disabled={total === 0}
              onClick={() => stepMatch(-1)}
            >
              <i className="codicon codicon-chevron-up" aria-hidden />
            </button>
            <button
              type="button"
              className="file-pane-search-btn"
              data-testid="file-search-next"
              title="下一处 (Enter)"
              aria-label="下一处"
              disabled={total === 0}
              onClick={() => stepMatch(1)}
            >
              <i className="codicon codicon-chevron-down" aria-hidden />
            </button>
            <button
              type="button"
              className="file-pane-search-btn"
              data-testid="file-search-close"
              title="关闭 (Esc)"
              aria-label="关闭"
              onClick={onCloseSearch}
            >
              <i className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        </div>
      )}
      <div className="file-pane-preview-body" ref={scrollRef}>
      {markdown && markdownMode === "preview" && (
        <div
          className="message-content markdown-content file-pane-markdown"
          onClick={handleMarkdownClick}
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
            const rangeEnd = fileView.endLine ?? fileView.startLine;
            const active =
              fileView.startLine !== undefined &&
              rangeEnd !== undefined &&
              lineNo >= fileView.startLine &&
              lineNo <= rangeEnd;
            const activeMatch =
              activeIndex >= 0 &&
              matches[activeIndex].lineIndex === i
                ? {
                    start: matches[activeIndex].startCol,
                    end: matches[activeIndex].endCol,
                  }
                : undefined;
            const html = wrapLineMatches(
              line,
              plainLines[i] ?? "",
              matchesByLine.get(i) ?? [],
              activeMatch,
            );
            return (
              <div
                key={i}
                className={`file-pane-line${active ? " file-pane-line--active" : ""}`}
              >
                <span className="file-pane-line-no">{lineNo}</span>
                <span
                  className="file-pane-line-code"
                  dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }}
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
    </div>
  );
};

export default FilePreview;
