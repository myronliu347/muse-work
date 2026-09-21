import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContentSearchState,
  FileSidebarMode,
  FileTreeState,
  SessionMetadata,
} from "../types";
import type { MuseApiClient } from "../muse/apiClient";
import {
  closeFileTab,
  openFileTab,
  pinFileTab,
  selectFileTab,
} from "../muse/fileTabs";
import { emptyContentSearchState } from "../stores";
import { pathToFileUrl } from "../utils/pathToFileUrl";
import type { ChatAppCore } from "./useChatAppCore";
import type { PanelHandlers } from "./usePanels";
import type { PreviewHandlers } from "./usePreview";

export interface FilePanelHandlers {
  handleOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  /** Open straight into a permanent (pinned) tab — file-tree double-click. */
  handleOpenFilePin: (path: string) => void;
  /**
   * Soft re-read: ask the host for fresh content without activating the file
   * panel (used by background refresh after an AI turn ends).
   */
  handleRefreshOpenFile: (path: string) => void;
  handleSelectFileTab: (path: string) => void;
  handleCloseFileTab: (path: string) => void;
  handlePinFileTab: (path: string) => void;
  handleRevealInFinder: (path: string) => void;
  handleOpenFileHistoryDiff: (path: string) => void;
  handleRevertFileHistory: (messageIds: string[]) => void;
  revertingFileHistory: boolean;
  handleFileTreeChange: (next: FileTreeState) => void;
  handleOpenLocalFilePreview: (path: string) => void;
  handleFileSidebarModeChange: (mode: FileSidebarMode) => void;
  handleContentSearchChange: (next: ContentSearchState) => void;
  runContentSearch: (next: ContentSearchState) => void;
}

interface UseFilePanelParams {
  postToHost: ChatAppCore["postToHost"];
  updatePanelGroup: ChatAppCore["updatePanelGroup"];
  tryOpenPanel: PanelHandlers["tryOpenPanel"];
  handleOpenPreview: PreviewHandlers["handleOpenPreview"];
  popoApi: MuseApiClient;
  currentSession: SessionMetadata | undefined;
  effectiveHost: string;
  effectiveWorkdir?: string;
  groupKey?: string;
  contentSearch: ContentSearchState;
}

export function useFilePanel({
  postToHost,
  updatePanelGroup,
  tryOpenPanel,
  handleOpenPreview,
  popoApi,
  currentSession,
  effectiveHost,
  effectiveWorkdir,
  groupKey,
  contentSearch,
}: UseFilePanelParams): FilePanelHandlers {
  // Reset file sidebar search when workdir changes (per-group memory stays
  // for tree width/expand; search mode/results start fresh).
  const contentSearchWorkdirRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!groupKey) return;
    const prev = contentSearchWorkdirRef.current;
    contentSearchWorkdirRef.current = effectiveWorkdir;
    if (prev === undefined) return;
    if (prev === effectiveWorkdir) return;
    updatePanelGroup({
      fileSidebarMode: "tree",
      contentSearch: emptyContentSearchState(),
    });
  }, [effectiveWorkdir, groupKey, updatePanelGroup]);

  const contentSearchSeqRef = useRef(0);
  const contentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (contentSearchTimerRef.current) {
        clearTimeout(contentSearchTimerRef.current);
      }
    };
  }, []);

  const runContentSearch = useCallback(
    (next: ContentSearchState) => {
      if (contentSearchTimerRef.current) {
        clearTimeout(contentSearchTimerRef.current);
        contentSearchTimerRef.current = null;
      }
      const q = next.query.trim();
      if (!q || !effectiveWorkdir) {
        updatePanelGroup({
          contentSearch: {
            ...next,
            loading: false,
            results: q ? next.results : [],
            error: undefined,
            truncated: undefined,
            requestId: undefined,
          },
        });
        return;
      }
      contentSearchTimerRef.current = setTimeout(() => {
        contentSearchTimerRef.current = null;
        const requestId = `cs-${++contentSearchSeqRef.current}`;
        updatePanelGroup({
          contentSearch: { ...next, loading: true, requestId, error: undefined },
        });
        postToHost({
          command: "desktopSearchContent",
          requestId,
          workdir: effectiveWorkdir,
          query: q,
          caseSensitive: next.caseSensitive,
          wholeWord: next.wholeWord,
          regex: next.regex,
        });
      }, 250);
    },
    [effectiveWorkdir, postToHost, updatePanelGroup],
  );

  const handleFileSidebarModeChange = useCallback(
    (mode: FileSidebarMode) => {
      updatePanelGroup({ fileSidebarMode: mode });
    },
    [updatePanelGroup],
  );

  const handleContentSearchChange = useCallback(
    (next: ContentSearchState) => {
      const prev = contentSearch;
      const searchKeyChanged =
        prev.query !== next.query ||
        prev.caseSensitive !== next.caseSensitive ||
        prev.wholeWord !== next.wholeWord ||
        prev.regex !== next.regex;
      updatePanelGroup({ contentSearch: next });
      if (searchKeyChanged) runContentSearch(next);
    },
    [contentSearch, runContentSearch, updatePanelGroup],
  );

  // Desktop file panel (spec: 文件面板): a file path clicked in a message or
  // terminal opens here instead of the OS. Show the panel immediately with a
  // loading stub; the host reads the file (local fs or over ssh) and replies
  // with desktopFileContent to fill it in. The host is captured per-pane so a
  // split-view sibling's click never resolves against this pane's host.
  // Multi-tab (VS Code preview semantics): already-open files are activated
  // (same path re-click keeps the old content until the reply lands — soft
  // refresh), new files enter a preview tab, replacing the existing preview.
  const handleOpenFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      if (!path) return;
      if (!tryOpenPanel("file")) return;
      updatePanelGroup((group) =>
        openFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
          effectiveHost,
          { startLine, endLine },
        ),
      );
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        workdir: effectiveWorkdir ?? undefined,
        startLine,
        endLine,
      });
    },
    [
      tryOpenPanel,
      effectiveHost,
      effectiveWorkdir,
      postToHost,
      updatePanelGroup,
    ],
  );

  // File-tree double-click: open straight into a permanent (pinned) tab so
  // it is never replaced by later preview opens.
  const handleOpenFilePin = useCallback(
    (path: string) => {
      if (!path) return;
      if (!tryOpenPanel("file")) return;
      updatePanelGroup((group) =>
        openFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
          effectiveHost,
          { pinned: true },
        ),
      );
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        workdir: effectiveWorkdir ?? undefined,
      });
    },
    [
      tryOpenPanel,
      effectiveHost,
      effectiveWorkdir,
      postToHost,
      updatePanelGroup,
    ],
  );

  // Soft re-read only — must not call tryOpenPanel. Generation-end refresh
  // runs while the file panel may be checked-but-inactive (user is on
  // preview/diff/terminal); activating would yank them away from the browser.
  const handleRefreshOpenFile = useCallback(
    (path: string) => {
      if (!path) return;
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        workdir: effectiveWorkdir ?? undefined,
      });
    },
    [effectiveHost, effectiveWorkdir, postToHost],
  );

  // Clicking a file-name tab in the dock's top bar also brings the file panel
  // forward (the tab bar is shared with the other panels).
  const handleSelectFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      if (!tryOpenPanel("file")) return;
      updatePanelGroup((group) =>
        selectFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
        ),
      );
    },
    [tryOpenPanel, updatePanelGroup],
  );

  const handleCloseFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      updatePanelGroup((group) =>
        closeFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
        ),
      );
    },
    [updatePanelGroup],
  );

  const handlePinFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      updatePanelGroup((group) =>
        pinFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
        ),
      );
    },
    [updatePanelGroup],
  );

  const handleRevealInFinder = useCallback(
    (path: string) => {
      if (!path) return;
      postToHost({ command: "revealInFinder", path });
    },
    [postToHost],
  );

  // File-history card row click: open the diff pane in "最近一次修改" mode,
  // targeting the file whose snapshot diff came from the last assistant message.
  const handleOpenFileHistoryDiff = useCallback(
    (path: string) => {
      if (!path) return;
      if (!tryOpenPanel("diff")) return;
      updatePanelGroup({
        diffView: {
          mode: "recent",
          file: { path },
        },
      });
    },
    [tryOpenPanel, updatePanelGroup],
  );

  // Undo button on the file-history card: restore the snapshots captured by
  // the newest turn. The server broadcasts messages:replace after reverting,
  // and since the reverted files now match their snapshots, the enriched
  // file_history block vanishes — the card disappears on its own.
  const [revertingFileHistory, setRevertingFileHistory] = useState(false);
  const handleRevertFileHistory = useCallback(
    (messageIds: string[]) => {
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;
      setRevertingFileHistory(true);
      void (async () => {
        try {
          await popoApi.revertFileHistory(
            currentSession!.id,
            messageIds,
          );
        } catch {
          // The card stays; user can retry. Server-side failure is surfaced
          // via the next messages:replace (unchanged) or an error block.
        } finally {
          setRevertingFileHistory(false);
        }
      })();
    },
    [currentSession, popoApi],
  );

  const handleFileTreeChange = useCallback(
    (next: FileTreeState) => {
      updatePanelGroup((group) => ({
        fileTree: {
          ...group.fileTree,
          expanded: next.expanded,
          selected: next.selected,
          width: next.width,
          collapsed: next.collapsed,
          childrenCache: {
            ...group.fileTree.childrenCache,
            ...next.childrenCache,
          },
        },
      }));
    },
    [updatePanelGroup],
  );

  // Local HTML files from the file panel preview in the built-in browser:
  // map the absolute path to a file:// URL and open the preview pane.
  const handleOpenLocalFilePreview = useCallback(
    (path: string) => {
      if (!path) return;
      handleOpenPreview(pathToFileUrl(path));
    },
    [handleOpenPreview],
  );

  return {
    handleOpenFile,
    handleOpenFilePin,
    handleRefreshOpenFile,
    handleSelectFileTab,
    handleCloseFileTab,
    handlePinFileTab,
    handleRevealInFinder,
    handleOpenFileHistoryDiff,
    handleRevertFileHistory,
    revertingFileHistory,
    handleFileTreeChange,
    handleOpenLocalFilePreview,
    handleFileSidebarModeChange,
    handleContentSearchChange,
    runContentSearch,
  };
}
