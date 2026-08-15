import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  DesktopPane,
  DesktopSessionGroup,
  DesktopWorkdirState,
} from "../types";

interface DesktopStore {
  workdirState: DesktopWorkdirState | null;
  sessionTree: DesktopSessionGroup[];
  panes: DesktopPane[];
  rowHeights: number[] | undefined;
  focusedPaneId: string | null;
  setWorkdirState: (state: DesktopWorkdirState) => void;
  setSessionTree: (groups: DesktopSessionGroup[]) => void;
  setPanes: (
    panes: DesktopPane[],
    rowHeights: number[] | undefined,
    focusedPaneId: string | null,
  ) => void;
  reset: () => void;
}

export const useDesktopStore = create<DesktopStore>((set) => ({
  workdirState: null,
  sessionTree: [],
  panes: [],
  rowHeights: undefined,
  focusedPaneId: null,

  setWorkdirState: (workdirState) => set({ workdirState }),
  setSessionTree: (sessionTree) => set({ sessionTree }),
  setPanes: (panes, rowHeights, focusedPaneId) =>
    set({ panes, rowHeights, focusedPaneId }),

  reset: () =>
    set({
      workdirState: null,
      sessionTree: [],
      panes: [],
      rowHeights: undefined,
      focusedPaneId: null,
    }),
}));

/** Single subscription for DesktopApp shell state + actions. */
export function useDesktopShell() {
  return useDesktopStore(
    useShallow((s) => ({
      workdirState: s.workdirState,
      sessionTree: s.sessionTree,
      panes: s.panes,
      rowHeights: s.rowHeights,
      focusedPaneId: s.focusedPaneId,
      setWorkdirState: s.setWorkdirState,
      setSessionTree: s.setSessionTree,
      setPanes: s.setPanes,
    })),
  );
}
