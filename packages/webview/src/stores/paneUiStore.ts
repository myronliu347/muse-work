import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Message, UpdateToast } from "../types";
import type { RewindCheckpoint } from "../components/dialogs/RewindPopup";
import { paneStoreKey } from "./paneKey";

export interface AgentTranscriptState {
  subagentId: string;
  title: string;
  nestedMessages?: Message[];
  fallbackText?: string;
  prompt?: string;
}

export interface BtwPanelState {
  question: string;
  answer: string;
  loading: boolean;
  contentStarted: boolean;
}

export interface PaneGitBranches {
  branches: string[];
  current: string;
}

export interface PaneUiSlice {
  queueEditWarning: string | null;
  toasts: UpdateToast[];
  pendingRewindId: string | null;
  rewindPopupOpen: boolean;
  rewindCheckpoints: RewindCheckpoint[];
  rewindCheckpointsLoading: boolean;
  modelPopupOpen: boolean;
  configuredModels: string[];
  currentModel: string | undefined;
  modelLoading: boolean;
  agentTranscript: AgentTranscriptState | null;
  btwPanel: BtwPanelState | null;
  worktreeBranch: string;
  worktreeChecked: boolean;
  paneGitBranches: PaneGitBranches | null;
}

export function emptyPaneUi(): PaneUiSlice {
  return {
    queueEditWarning: null,
    toasts: [],
    pendingRewindId: null,
    rewindPopupOpen: false,
    rewindCheckpoints: [],
    rewindCheckpointsLoading: false,
    modelPopupOpen: false,
    configuredModels: [],
    currentModel: undefined,
    modelLoading: false,
    agentTranscript: null,
    btwPanel: null,
    worktreeBranch: "",
    worktreeChecked: false,
    paneGitBranches: null,
  };
}

interface PaneUiStore {
  panes: Record<string, PaneUiSlice>;
  patchPane: (
    key: string,
    patch: Partial<PaneUiSlice> | ((slice: PaneUiSlice) => Partial<PaneUiSlice>),
  ) => void;
  reset: () => void;
}

export const usePaneUiStore = create<PaneUiStore>((set, get) => ({
  panes: {},

  patchPane: (key, patch) => {
    set((s) => {
      const current = s.panes[key] ?? emptyPaneUi();
      const nextPatch = typeof patch === "function" ? patch(current) : patch;
      return {
        panes: { ...s.panes, [key]: { ...current, ...nextPatch } },
      };
    });
  },

  reset: () => set({ panes: {} }),
}));

const EMPTY_PANE_UI = emptyPaneUi();

export function usePaneUi(paneId?: string): PaneUiSlice {
  const key = paneStoreKey(paneId);
  return usePaneUiStore(
    useShallow((s) => s.panes[key] ?? EMPTY_PANE_UI),
  );
}

export function patchPaneUi(
  paneId: string | undefined,
  patch: Partial<PaneUiSlice> | ((slice: PaneUiSlice) => Partial<PaneUiSlice>),
): void {
  usePaneUiStore.getState().patchPane(paneStoreKey(paneId), patch);
}
