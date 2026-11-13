import { useCallback } from "react";
import type React from "react";
import { ASSISTANT_PANEL_GROUP_KEY, usePanelGroupStore } from "../stores";
import type { DesktopPanelKind } from "../types";

/**
 * File tabs opened from a transcript. Issue files stay on that issue; bot-page
 * files stay on the assistant bar.
 */
export function useShownFileTabs({
  assistantVisibleRef,
  onSessionsSurfaceRef,
  previewGroupKeyRef,
  groupKeyRef,
  selectDockRef,
  setAssistantDockOpen,
  onSessionsSurface,
  openFileTabInGroup,
  handleOpenFileHistoryDiff,
  handleSelectFileTab,
  handleCloseFileTab,
  handlePinFileTab,
}: {
  assistantVisibleRef: React.MutableRefObject<boolean>;
  onSessionsSurfaceRef: React.MutableRefObject<boolean>;
  previewGroupKeyRef: React.MutableRefObject<string | undefined>;
  groupKeyRef: React.MutableRefObject<string | undefined>;
  selectDockRef: React.MutableRefObject<(kind: DesktopPanelKind) => void>;
  setAssistantDockOpen: (open: boolean) => void;
  onSessionsSurface: boolean;
  openFileTabInGroup: (
    path: string,
    startLine?: number,
    endLine?: number,
    pinned?: boolean,
  ) => void;
  handleOpenFileHistoryDiff: (path: string) => boolean;
  handleSelectFileTab: (path: string) => void;
  handleCloseFileTab: (path: string) => void;
  handlePinFileTab: (path: string) => void;
}) {
  // 详情 doesn't change the directory group's active kind. Opening a file
  // while that kind is already "file" would update the tab and leave the
  // dock on 详情. The visible pane follows the chrome tab, so a session
  // whose chrome is already 变更 stays there unless we select 文件 too.
  const revealOpenedFile = useCallback(() => {
    const onBot = assistantVisibleRef.current;
    const onSessions = onSessionsSurfaceRef.current;
    if (!onBot && !onSessions) return;
    const store = usePanelGroupStore.getState();
    const keys = [
      previewGroupKeyRef.current,
      groupKeyRef.current,
      ASSISTANT_PANEL_GROUP_KEY,
    ];
    const opened = keys.some((key) => {
      if (!key) return false;
      const group = store.groups[key];
      return group?.active === "file" || Boolean(group?.checked?.includes("file"));
    });
    if (!opened) return;
    if (onBot) setAssistantDockOpen(true);
    selectDockRef.current("file");
  }, [setAssistantDockOpen]);
  const handleOpenFile = useCallback(
    (path: string, startLine?: number, endLine?: number, pinned?: boolean) => {
      openFileTabInGroup(path, startLine, endLine, pinned);
      if (!path) return;
      revealOpenedFile();
    },
    [openFileTabInGroup, revealOpenedFile],
  );
  // A file link in the conversation opens a permanent tab. A later preview
  // open must not replace it.
  const openMessageFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      handleOpenFile(path, startLine, endLine, true);
    },
    [handleOpenFile],
  );
  // All file links open into the assistant's own tab list now; the file tree
  // derives its directory from the active file instead of the issue.
  const openIssueMessageFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      openMessageFile(path, startLine, endLine);
    },
    [openMessageFile],
  );
  // The card click has to bring 变更 forward. On an issue the dock otherwise
  // stays on 详情, and the directory's active kind never becomes the visible tab.
  const openFileHistoryDiff = useCallback(
    (path: string) => {
      if (!handleOpenFileHistoryDiff(path)) return;
      if (assistantVisibleRef.current) setAssistantDockOpen(true);
      if (assistantVisibleRef.current || onSessionsSurface) {
        selectDockRef.current("diff");
      }
    },
    [handleOpenFileHistoryDiff, onSessionsSurface, setAssistantDockOpen],
  );
  const selectShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      handleSelectFileTab(path);
    },
    [handleSelectFileTab],
  );
  const closeShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      handleCloseFileTab(path);
    },
    [handleCloseFileTab],
  );
  const pinShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      handlePinFileTab(path);
    },
    [handlePinFileTab],
  );

  return {
    revealOpenedFile,
    handleOpenFile,
    openMessageFile,
    openIssueMessageFile,
    openFileHistoryDiff,
    selectShownFileTab,
    closeShownFileTab,
    pinShownFileTab,
  };
}
