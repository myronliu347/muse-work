export { useDesktopStore, useDesktopShell } from "./desktopStore";
export {
  usePanelGroupStore,
  usePanelGroup,
  prunePanelGroupCache,
  workdirTermId,
  emptyPanelGroup,
  resolvePanelGroup,
  isDraftGroupKey,
  nextActivePanelAfterClose,
  PANEL_DEFAULT_WIDTH,
  type PanelGroupState,
  type PanelGroupView,
  type RemoteForwardRef,
} from "./panelGroupStore";
export {
  usePaneUiStore,
  usePaneUi,
  patchPaneUi,
  emptyPaneUi,
  type AgentTranscriptState,
  type BtwPanelState,
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
