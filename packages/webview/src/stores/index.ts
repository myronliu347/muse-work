export { useDesktopStore, useDesktopShell } from "./desktopStore";
export {
  usePanelGroupStore,
  usePanelGroup,
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
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_DEFAULT,
  type PanelGroupState,
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

import { useDesktopStore } from "./desktopStore";
import { usePanelGroupStore } from "./panelGroupStore";
import { usePaneUiStore } from "./paneUiStore";

export function resetWebviewStores(): void {
  useDesktopStore.getState().reset();
  usePanelGroupStore.getState().reset();
  usePaneUiStore.getState().reset();
}
