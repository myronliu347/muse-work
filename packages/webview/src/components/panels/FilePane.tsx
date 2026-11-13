import { beginSplitDrag, widthFromRightEdge } from "../../muse/splitDrag";
import React, { useEffect, useRef, useState } from "react";
import type {
  ContentSearchState,
  FileSidebarMode,
  FileTreeState,
  FileViewState,
} from "../../types";
import {
  ensureExpandedForFile,
  emptyFileTreeState,
  emptyContentSearchState,
} from "../../stores/panelGroupStore";
import { FilePathBar } from "./FilePathBar";
import { FilePreview, type FileSelectionChatTarget } from "./FilePreview";
import { FileTree, requestDirListings } from "./FileTree";
import { PANEL_MOTION_MS, useExitHold } from "../../hooks/useExitHold";
import "../../styles/FilePane.css";

const MIN_WIDTH = 320;

const isMarkdownPath = (path: string) =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

export interface FilePaneProps {
  fileView: FileViewState | null;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthPreview?: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  workdir?: string;
  vscode: { postMessage: (msg: unknown) => void };
  fileTree?: FileTreeState;
  onFileTreeChange?: (next: FileTreeState) => void;
  fileSidebarMode?: FileSidebarMode;
  onFileSidebarModeChange?: (mode: FileSidebarMode) => void;
  contentSearch?: ContentSearchState;
  onContentSearchChange?: (next: ContentSearchState) => void;
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  /** File-tree double-click: open as a permanent (pinned) tab. */
  onOpenFilePinned?: (path: string) => void;
  /**
   * Soft re-read of the open file without activating the file panel.
   * Used by toolbar refresh and generation-end auto-refresh.
   */
  onRefreshOpenFile?: (path: string) => void;
  /** Local HTML files: open in the built-in browser preview instead of the OS. */
  onOpenInPreview?: (path: string) => void;
  onRevealInFinder?: (path: string) => void;
  /** Insert a code selection into the composer that is in use. */
  onAddSelectionToChat?: (selection: FileSelectionChatTarget) => void;
  /** True while the AI is generating; its falling edge auto-refreshes the tree
   * and re-reads the open file (same pattern as DiffPane). */
  isStreaming?: boolean;
  /** Whether the file panel is open; auto-refresh is skipped when hidden. */
  visible?: boolean;
}

export const FilePane: React.FC<FilePaneProps> = ({
  fileView,
  width,
  onWidthChange,
  onWidthPreview,
  maxWidth,
  workdir,
  vscode,
  fileTree = emptyFileTreeState(),
  onFileTreeChange,
  fileSidebarMode = "tree",
  onFileSidebarModeChange,
  contentSearch = emptyContentSearchState(),
  onContentSearchChange,
  onOpenFile,
  onOpenFilePinned,
  onRefreshOpenFile,
  onOpenInPreview,
  onRevealInFinder,
  onAddSelectionToChat,
  isStreaming,
  visible,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const fileTreeRef = useRef(fileTree);
  fileTreeRef.current = fileTree;
  // Collapse on the empty pane is a choice. Coming back to an empty pane
  // opens the tree again, since there is nothing else to browse.
  const collapsedWhileEmpty = useRef(false);
  // Markdown preview/source mode is remembered per file (tab switch restores
  // each tab's mode). Search-open is NOT per-tab — it resets on path change.
  const [mdModeByPath, setMdModeByPath] = useState<
    Record<string, "preview" | "source">
  >({});
  const mdMode = fileView
    ? (mdModeByPath[fileView.path] ?? "preview")
    : "preview";
  const setMdModeForActive = (mode: "preview" | "source") => {
    if (!fileView) return;
    setMdModeByPath((prev) => ({ ...prev, [fileView.path]: mode }));
  };
  // Per-tab scroll offsets, recorded from the preview's scroll container so
  // switching tabs restores each file's position (see FilePreview props).
  const scrollTopsRef = useRef<Record<string, number>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  // One-shot: only an explicit expand click should slide the tree column in.
  const [animateTreeOpen, setAnimateTreeOpen] = useState(false);
  const lastPathRef = useRef<string | null>(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    if (!fileView?.path || !workdir || !onFileTreeChange) return;
    if (lastPathRef.current === fileView.path) return;
    lastPathRef.current = fileView.path;
    onFileTreeChange(
      ensureExpandedForFile(fileTree, workdir, fileView.path),
    );
    setSearchOpen(false);
    // Only react to path changes; fileTree identity intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileView?.path, workdir]);

  useEffect(() => {
    if (fileView) {
      collapsedWhileEmpty.current = false;
      return;
    }
    if (!onFileTreeChange || collapsedWhileEmpty.current) return;
    const tree = fileTreeRef.current;
    if (tree.collapsed === false) return;
    onFileTreeChange({ ...tree, collapsed: false });
  }, [fileView, onFileTreeChange]);

  // Drag the left edge: the right edge is the anchor, so the width is whatever
  // the pointer leaves. The live width only touches the DOM; the width lands in
  // state (and the panel snapshot) once, on release.
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const right = asideRef.current?.getBoundingClientRect().right ?? 0;
    beginSplitDrag(e, {
      startValue: width,
      value: (ev) =>
        widthFromRightEdge(right, ev, (next) =>
          Math.min(Math.max(next, MIN_WIDTH), maxWidth),
        ),
      preview: (next) => {
        if (asideRef.current) asideRef.current.style.width = `${next}px`;
        onWidthPreview?.(next);
      },
      commit: onWidthChange,
    });
  };

  const isMd = !!(fileView?.content && isMarkdownPath(fileView.path));
  const isHtml =
    fileView?.host === "local" && /\.(html?|xhtml)$/i.test(fileView.path);
  const treeCollapsed = fileTree.collapsed !== false;
  const showTreeToggle = Boolean(onFileTreeChange);
  const treePresence = useExitHold(showTreeToggle && !treeCollapsed);

  // Find-in-file is available whenever the code/source view renders.
  const canSearch =
    !!fileView?.content &&
    !fileView.error &&
    !fileView.unsupported &&
    !(isMd && mdMode === "preview");

  useEffect(() => {
    if (!canSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSearch]);

  const toggleTreeCollapsed = () => {
    if (!onFileTreeChange) return;
    const nextCollapsed = !treeCollapsed;
    if (!fileView) collapsedWhileEmpty.current = nextCollapsed;
    setAnimateTreeOpen(!nextCollapsed);
    onFileTreeChange({ ...fileTree, collapsed: nextCollapsed });
  };

  // Hiding the panel mid-animation must not make the next open replay it.
  useEffect(() => {
    if (visible === false) setAnimateTreeOpen(false);
  }, [visible]);
  // `onAnimationEnd` clears this in the browser; the timer covers
  // prefers-reduced-motion (no animation event) and an interrupted mount.
  useEffect(() => {
    if (!animateTreeOpen) return;
    const timer = setTimeout(
      () => setAnimateTreeOpen(false),
      PANEL_MOTION_MS + 50,
    );
    return () => clearTimeout(timer);
  }, [animateTreeOpen]);

  // Re-request the currently open file from the host (soft refresh: old
  // content stays visible until the reply lands). Must not go through
  // onOpenFile — that activates the file panel and would yank the user
  // away from preview/diff/terminal after every AI turn.
  const refreshOpenFile = () => {
    if (!fileView?.path) return;
    if (onRefreshOpenFile) {
      onRefreshOpenFile(fileView.path);
      return;
    }
    onOpenFile(fileView.path);
  };

  // Same scope as the tree's refresh button: re-read the open file and
  // re-fetch the directory listings. Used when the tree is collapsed (its
  // own refresh button is hidden with it), so expanding shows fresh data.
  const handleRefresh = () => {
    refreshOpenFile();
    if (!workdir || !onFileTreeChange) return;
    const dirs = [""];
    for (const dir of fileTree.expanded) {
      if (!dirs.includes(dir)) dirs.push(dir);
    }
    onFileTreeChange({ ...fileTree, childrenCache: {} });
    requestDirListings(vscode, workdir, dirs);
  };

  // When an AI turn finishes (isStreaming falling edge) while the panel is
  // open, refresh like the refresh button: re-read the open file and re-fetch
  // the listings, so the panel shows what the agent just wrote. Mirrors
  // DiffPane's generationEnded refresh.
  useEffect(() => {
    const prev = streamingRef.current;
    streamingRef.current = Boolean(isStreaming);
    if (prev && !isStreaming && visible !== false) {
      handleRefresh();
    }
    // handleRefresh intentionally omitted: the effect reads the latest
    // closure from the render where isStreaming/visible changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, visible]);

  return (
    <aside
      ref={asideRef}
      className="preview-pane file-pane"
      style={{ width }}
      data-testid="file-pane"
    >
      <div className="preview-pane-drag-handle" onPointerDown={onDragStart} />
      <div className="preview-pane-inner file-pane-inner">
        <div className="preview-pane-toolbar">
          {fileView ? (
            <FilePathBar path={fileView.path} workdir={workdir} />
          ) : (
            <span className="preview-pane-url">文件</span>
          )}
          <div className="file-pane-toolbar-actions">
            {isMd && (
              <div className="file-pane-md-toggle" data-testid="file-md-toggle">
                <button
                  type="button"
                  className="preview-pane-button"
                  aria-pressed={mdMode === "preview"}
                  onClick={() => setMdModeForActive("preview")}
                >
                  预览
                </button>
                <button
                  type="button"
                  className="preview-pane-button"
                  aria-pressed={mdMode === "source"}
                  onClick={() => setMdModeForActive("source")}
                >
                  源码
                </button>
              </div>
            )}
            {isHtml && (
              <button
                type="button"
                className="preview-pane-button"
                data-testid="file-open-in-browser"
                title="在内置浏览器中打开"
                aria-label="在内置浏览器中打开"
                onClick={() => onOpenInPreview?.(fileView.path)}
              >
                <i className="codicon codicon-globe" aria-hidden />
              </button>
            )}
            {showTreeToggle && onFileSidebarModeChange && !treeCollapsed && (
              <button
                type="button"
                className="preview-pane-button"
                data-testid="file-sidebar-mode-search"
                aria-pressed={fileSidebarMode === "search"}
                title={fileSidebarMode === "search" ? "返回文件树" : "搜索"}
                onClick={() =>
                  onFileSidebarModeChange(fileSidebarMode === "search" ? "tree" : "search")
                }
              >
                <i className="codicon codicon-search" aria-hidden />
              </button>
            )}
            {showTreeToggle && (
              <button
                type="button"
                className="preview-pane-button"
                data-testid="file-refresh-btn"
                title="刷新目录与文件"
                aria-label="刷新目录与文件"
                onClick={handleRefresh}
              >
                <i className="codicon codicon-refresh" aria-hidden />
              </button>
            )}
            {showTreeToggle && (
              <button
                type="button"
                className="preview-pane-button"
                data-testid={treeCollapsed ? "file-tree-expand-btn" : "file-tree-collapse-btn"}
                title={treeCollapsed ? "展开文件树" : "收起文件树"}
                aria-label={treeCollapsed ? "展开文件树" : "收起文件树"}
                aria-pressed={!treeCollapsed}
                onClick={toggleTreeCollapsed}
              >
                <i className="codicon codicon-list-tree" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div className="file-pane-main">
          <div className="file-pane-left">
            <div className="preview-pane-body file-pane-body">
              {!fileView && (
                <div className="desktop-panel-placeholder">
                  <i className="codicon codicon-file file-pane-placeholder-icon" />
                  <span>从消息或文件树打开文件</span>
                </div>
              )}
              {fileView && (
                <FilePreview
                  fileView={fileView}
                  workdir={workdir}
                  onRevealInFinder={onRevealInFinder}
                  markdownMode={mdMode}
                  onOpenFile={onOpenFile}
                  onOpenExternal={(url) =>
                    vscode.postMessage({ command: "openExternal", url })
                  }
                  searchOpen={searchOpen}
                  onCloseSearch={() => setSearchOpen(false)}
                  savedScrollTop={
                    fileView ? scrollTopsRef.current[fileView.path] : undefined
                  }
                  onScrollChange={(scrollTop) => {
                    scrollTopsRef.current[fileView.path] = scrollTop;
                  }}
                  onAddSelectionToChat={onAddSelectionToChat}
                />
              )}
            </div>
          </div>
          {onFileTreeChange && treePresence.show && (
            <FileTree
              key={workdir ?? ""}
              workdir={workdir}
              vscode={vscode}
              tree={fileTree}
              closing={treePresence.closing}
              animateOpen={animateTreeOpen}
              onOpenAnimationEnd={() => setAnimateTreeOpen(false)}
              onTreeChange={onFileTreeChange}
              onOpenFile={(path) => onOpenFile(path)}
              onOpenFilePinned={onOpenFilePinned}
              onRefreshFile={refreshOpenFile}
              sidebarMode={fileSidebarMode}
              onSidebarModeChange={onFileSidebarModeChange}
              contentSearch={contentSearch}
              onContentSearchChange={onContentSearchChange}
              onOpenMatch={(path, line) => onOpenFile(path, line)}
            />
          )}
        </div>
      </div>
    </aside>
  );
};

export default FilePane;
