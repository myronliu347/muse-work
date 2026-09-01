import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  DesktopIssueGroup,
  DesktopPane,
  DesktopSessionGroup,
  DesktopWorkdirState,
} from "../types";

interface DesktopStore {
  workdirState: DesktopWorkdirState | null;
  sessionTree: DesktopSessionGroup[];
  issueGroups: DesktopIssueGroup[];
  panes: DesktopPane[];
  rowHeights: number[] | undefined;
  focusedPaneId: string | null;
  setWorkdirState: (state: DesktopWorkdirState) => void;
  setSessionTree: (groups: DesktopSessionGroup[]) => void;
  setIssueGroups: (groups: DesktopIssueGroup[]) => void;
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
  issueGroups: [],
  panes: [],
  rowHeights: undefined,
  focusedPaneId: null,

  setWorkdirState: (workdirState) => set({ workdirState }),
  setSessionTree: (sessionTree) => set({ sessionTree }),
  setIssueGroups: (issueGroups) => set({ issueGroups }),
  setPanes: (panes, rowHeights, focusedPaneId) =>
    set({ panes, rowHeights, focusedPaneId }),

  reset: () =>
    set({
      workdirState: null,
      sessionTree: [],
      issueGroups: [],
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
      issueGroups: s.issueGroups,
      panes: s.panes,
      rowHeights: s.rowHeights,
      focusedPaneId: s.focusedPaneId,
      setWorkdirState: s.setWorkdirState,
      setSessionTree: s.setSessionTree,
      setIssueGroups: s.setIssueGroups,
      setPanes: s.setPanes,
    })),
  );
}
