import { useCallback } from "react";
import type React from "react";
import { filesReferToSame, openFileTab, pinFileTab, selectFileTab } from "../muse/fileTabs";
import { ASSISTANT_PANEL_GROUP_KEY, issueFileGroupKey, usePanelGroupStore } from "../stores";
import { applyCloseFileTab } from "../stores/panelGroupStore";
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
  shownIssueIdRef,
  dockIssueIdRef,
  dockWorkdirRef,
  selectDockRef,
  setAssistantDockOpen,
  onSessionsSurface,
  tryOpenPanel,
  openFileTabInGroup,
  handleOpenFileHistoryDiff,
  handleSelectFileTab,
  handleCloseFileTab,
  handlePinFileTab,
  postToHost,
  effectiveHost,
}: {
  assistantVisibleRef: React.MutableRefObject<boolean>;
  onSessionsSurfaceRef: React.MutableRefObject<boolean>;
  previewGroupKeyRef: React.MutableRefObject<string | undefined>;
  groupKeyRef: React.MutableRefObject<string | undefined>;
  shownIssueIdRef: React.MutableRefObject<string | undefined>;
  dockIssueIdRef: React.MutableRefObject<string | null | undefined>;
  dockWorkdirRef: React.MutableRefObject<string | null | undefined>;
  selectDockRef: React.MutableRefObject<(kind: DesktopPanelKind) => void>;
  setAssistantDockOpen: (open: boolean) => void;
  onSessionsSurface: boolean;
  tryOpenPanel: (kind: DesktopPanelKind) => boolean;
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
  postToHost: (message: Record<string, unknown>) => void;
  effectiveHost: string;
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
  // Issue transcript links stay on that issue. Bot-page opens stay resident.
  const openIssueMessageFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      if (!path) return;
      if (!assistantVisibleRef.current) {
        openMessageFile(path, startLine, endLine);
        return;
      }
      if (!tryOpenPanel("file")) return;
      const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
      const key = ownedId ? issueFileGroupKey(ownedId) : previewGroupKeyRef.current;
      if (!key) return;
      const store = usePanelGroupStore.getState();
      store.patchGroup(key, (group) =>
        openFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
          effectiveHost,
          { startLine, endLine, pinned: true },
        ),
      );
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, { activeFilePath: null });
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        workdir: dockWorkdirRef.current,
        startLine,
        endLine,
        fileGroupKey: key,
      });
      setAssistantDockOpen(true);
      selectDockRef.current("file");
    },
    [effectiveHost, openMessageFile, postToHost, setAssistantDockOpen, tryOpenPanel],
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
  const issueOwnsFileTab = useCallback((path: string) => {
    if (!assistantVisibleRef.current) return false;
    const store = usePanelGroupStore.getState();
    const onAssistant = (store.groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs ?? []).some(
      (tab) => filesReferToSame(tab, { path }),
    );
    if (onAssistant) return false;
    const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
    if (!ownedId) return false;
    const issueKey = issueFileGroupKey(ownedId);
    return (store.groups[issueKey]?.fileTabs ?? []).some((tab) =>
      filesReferToSame(tab, { path }),
    );
  }, []);
  const selectShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
      const issueKey = ownedId ? issueFileGroupKey(ownedId) : undefined;
      if (issueOwnsFileTab(path) && issueKey) {
        if (!tryOpenPanel("file")) return;
        const store = usePanelGroupStore.getState();
        store.patchGroup(issueKey, (group) =>
          selectFileTab(
            {
              fileTabs: group.fileTabs ?? [],
              activeFilePath: group.activeFilePath ?? null,
            },
            path,
          ),
        );
        store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, { activeFilePath: null });
        return;
      }
      handleSelectFileTab(path);
    },
    [handleSelectFileTab, issueOwnsFileTab, tryOpenPanel],
  );
  const closeShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
      const issueKey = ownedId ? issueFileGroupKey(ownedId) : undefined;
      if (issueOwnsFileTab(path) && issueKey) {
        usePanelGroupStore.getState().patchGroup(issueKey, (group) => {
          const tabs = group.fileTabs ?? [];
          if (!tabs.some((tab) => filesReferToSame(tab, { path }))) return {};
          return applyCloseFileTab(group, path);
        });
        return;
      }
      handleCloseFileTab(path);
    },
    [handleCloseFileTab, issueOwnsFileTab],
  );
  const pinShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
      const issueKey = ownedId ? issueFileGroupKey(ownedId) : undefined;
      if (issueOwnsFileTab(path) && issueKey) {
        usePanelGroupStore.getState().patchGroup(issueKey, (group) =>
          pinFileTab(
            {
              fileTabs: group.fileTabs ?? [],
              activeFilePath: group.activeFilePath ?? null,
            },
            path,
          ),
        );
        return;
      }
      handlePinFileTab(path);
    },
    [handlePinFileTab, issueOwnsFileTab],
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
