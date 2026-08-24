import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  DesktopPane,
  DesktopSessionGroup,
  DesktopTodoGroup,
  DesktopWorkdirState,
} from "../types";

interface DesktopStore {
  workdirState: DesktopWorkdirState | null;
  sessionTree: DesktopSessionGroup[];
  todoGroups: DesktopTodoGroup[];
  panes: DesktopPane[];
  rowHeights: number[] | undefined;
  focusedPaneId: string | null;
  setWorkdirState: (state: DesktopWorkdirState) => void;
  setSessionTree: (groups: DesktopSessionGroup[]) => void;
  setTodoGroups: (groups: DesktopTodoGroup[]) => void;
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
  todoGroups: [],
  panes: [],
  rowHeights: undefined,
  focusedPaneId: null,

  setWorkdirState: (workdirState) => set({ workdirState }),
  setSessionTree: (sessionTree) => set({ sessionTree }),
  setTodoGroups: (todoGroups) => set({ todoGroups }),
  setPanes: (panes, rowHeights, focusedPaneId) =>
    set({ panes, rowHeights, focusedPaneId }),

  reset: () =>
    set({
      workdirState: null,
      sessionTree: [],
      todoGroups: [],
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
      todoGroups: s.todoGroups,
      panes: s.panes,
      rowHeights: s.rowHeights,
      focusedPaneId: s.focusedPaneId,
      setWorkdirState: s.setWorkdirState,
      setSessionTree: s.setSessionTree,
      setTodoGroups: s.setTodoGroups,
      setPanes: s.setPanes,
    })),
  );
}
