export { useDesktopStore, useDesktopShell } from "./desktopStore";
export {
  usePanelGroupStore,
  usePanelGroup,
  ASSISTANT_PANEL_GROUP_KEY,
  issueFileGroupKey,
  prunePanelGroupCache,
  workdirTermId,
  emptyPanelGroup,
  emptyFileTreeState,
  emptyContentSearchState,
  clampFileTreeWidth,
  ensureExpandedForFile,
  resolvePanelGroup,
  isDraftGroupKey,
  nextActivePanelAfterClose,
  releasePanelContent,
  PANEL_DEFAULT_WIDTH,
  EMPTY_DOCK_TOOLS,
  EMPTY_TAB_ORDER,
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_DEFAULT,
  type PanelGroupState,
  type DockToolInstance,
  type PanelGroupView,
  type RemoteForwardRef,
  type FileTreeState,
  type FileTreeDirEntry,
  type FileSidebarMode,
  type ContentSearchState,
} from "./panelGroupStore";
export {
  usePaneUiStore,
  usePaneUi,
  patchPaneUi,
  emptyPaneUi,
  type AgentTranscriptState,
  type PaneGitBranches,
  type PaneUiSlice,
} from "./paneUiStore";
export { paneStoreKey } from "./paneKey";

import { resetDesktopContentSearchRequests } from "../muse/contentSearchRequests";
import { resetDesktopListDirRequests } from "../muse/listDirRequests";
import { useDesktopStore } from "./desktopStore";
import { usePanelGroupStore } from "./panelGroupStore";
import { resetBotPagePersistence } from "../muse/botPageState";
import { usePaneUiStore } from "./paneUiStore";

export function resetWebviewStores(): void {
  resetBotPagePersistence();
  useDesktopStore.getState().reset();
  usePanelGroupStore.getState().reset();
  usePaneUiStore.getState().reset();
  resetDesktopListDirRequests();
  resetDesktopContentSearchRequests();
}
