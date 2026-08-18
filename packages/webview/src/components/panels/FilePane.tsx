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
import { FilePreview } from "./FilePreview";
import { FileTree, requestDirListings } from "./FileTree";
import "../../styles/FilePane.css";

const MIN_WIDTH = 320;

const isMarkdownPath = (path: string) =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

export interface FilePaneProps {
  fileView: FileViewState | null;
  width: number;
  onWidthChange: (width: number) => void;
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
  /** Local HTML files: open in the built-in browser preview instead of the OS. */
  onOpenInPreview?: (path: string) => void;
  onRevealInFinder?: (path: string) => void;
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
  onOpenInPreview,
  onRevealInFinder,
  isStreaming,
  visible,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const [mdMode, setMdMode] = useState<"preview" | "source">("preview");
  const [searchOpen, setSearchOpen] = useState(false);
  const lastPathRef = useRef<string | null>(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    if (!fileView?.path || !workdir || !onFileTreeChange) return;
    if (lastPathRef.current === fileView.path) return;
    lastPathRef.current = fileView.path;
    onFileTreeChange(
      ensureExpandedForFile(fileTree, workdir, fileView.path),
    );
    setMdMode("preview");
    setSearchOpen(false);
    // Only react to path changes; fileTree identity intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileView?.path, workdir]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const isMd = !!(fileView?.content && isMarkdownPath(fileView.path));
  const isHtml =
    fileView?.host === "local" && /\.(html?|xhtml)$/i.test(fileView.path);
  const treeCollapsed = fileTree.collapsed !== false;
  const showTreeToggle = Boolean(onFileTreeChange);

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
    onFileTreeChange({ ...fileTree, collapsed: !treeCollapsed });
  };

  // Re-request the currently open file from the host (soft refresh: old
  // content stays visible until the reply lands). Shared by the tree's
  // refresh and the collapsed-toolbar refresh.
  const refreshOpenFile = () => {
    if (fileView?.path) onOpenFile(fileView.path);
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
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner file-pane-inner">
        <div className="file-pane-left">
          <div className="preview-pane-toolbar">
            {fileView ? (
              <FilePathBar path={fileView.path} workdir={workdir} />
            ) : (
              <span className="preview-pane-url">文件</span>
            )}
            <div className="file-pane-toolbar-actions">
              {canSearch && (
                <button
                  type="button"
                  className="preview-pane-button"
                  data-testid="file-search-btn"
                  title="在文件中查找 (Cmd+F)"
                  aria-label="在文件中查找"
                  aria-pressed={searchOpen}
                  onClick={() => setSearchOpen((v) => !v)}
                >
                  <i className="codicon codicon-search" aria-hidden />
                </button>
              )}
              {isMd && (
                <div className="file-pane-md-toggle" data-testid="file-md-toggle">
                  <button
                    type="button"
                    className="preview-pane-button"
                    aria-pressed={mdMode === "preview"}
                    onClick={() => setMdMode("preview")}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    className="preview-pane-button"
                    aria-pressed={mdMode === "source"}
                    onClick={() => setMdMode("source")}
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
              {showTreeToggle && treeCollapsed && (
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
              {showTreeToggle && treeCollapsed && (
                <button
                  type="button"
                  className="preview-pane-button"
                  data-testid="file-tree-expand-btn"
                  title="展开文件树"
                  aria-label="展开文件树"
                  aria-pressed={false}
                  onClick={toggleTreeCollapsed}
                >
                  <i className="codicon codicon-list-tree" aria-hidden />
                </button>
              )}
            </div>
          </div>
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
              />
            )}
          </div>
        </div>
        {onFileTreeChange && !treeCollapsed && (
          <FileTree
            workdir={workdir}
            vscode={vscode}
            tree={fileTree}
            onTreeChange={onFileTreeChange}
            onOpenFile={(path) => onOpenFile(path)}
            onRefreshFile={refreshOpenFile}
            sidebarMode={fileSidebarMode}
            onSidebarModeChange={onFileSidebarModeChange}
            contentSearch={contentSearch}
            onContentSearchChange={onContentSearchChange}
            onOpenMatch={(path, line) => onOpenFile(path, line)}
          />
        )}
      </div>
    </aside>
  );
};

export default FilePane;
