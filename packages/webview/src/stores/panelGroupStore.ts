import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { firstPanelTab } from "../muse/panelTabs";
import type { DesktopPanelKind, FileViewState } from "../types";

export const PANEL_DEFAULT_WIDTH = 420;

export interface RemoteForwardRef {
  host: string;
  remotePort: number;
  originalUrl: string;
  requestId: string;
}

export interface PanelGroupState {
  checked: DesktopPanelKind[];
  mounted: DesktopPanelKind[];
  active: DesktopPanelKind | null;
  widths: Record<DesktopPanelKind, number>;
  previewUrl: string | null;
  fileView: FileViewState | null;
  forward: RemoteForwardRef | null;
  forwardError: string | null;
}

export function emptyPanelGroup(): PanelGroupState {
  return {
    checked: [],
    mounted: [],
    active: null,
    widths: {
      preview: PANEL_DEFAULT_WIDTH,
      diff: PANEL_DEFAULT_WIDTH,
      terminal: PANEL_DEFAULT_WIDTH,
      file: PANEL_DEFAULT_WIDTH,
    },
    previewUrl: null,
    fileView: null,
    forward: null,
    forwardError: null,
  };
}

const EMPTY_GROUP = emptyPanelGroup();

export function isDraftGroupKey(groupKey: string | undefined): boolean {
  return groupKey === "__draft__";
}

export function resolvePanelGroup(
  groups: Record<string, PanelGroupState>,
  groupKey: string | undefined,
): PanelGroupState {
  if (!groupKey || isDraftGroupKey(groupKey)) return EMPTY_GROUP;
  return groups[groupKey] ?? EMPTY_GROUP;
}

interface PanelGroupStore {
  groups: Record<string, PanelGroupState>;
  previewEpochs: Record<string, number>;
  ensureGroup: (key: string) => PanelGroupState;
  patchGroup: (
    key: string,
    patch: Partial<PanelGroupState> | ((group: PanelGroupState) => Partial<PanelGroupState>),
  ) => void;
  migrateGroup: (fromKey: string, toKey: string) => void;
  pruneGroups: (keepKeys: Set<string>) => void;
  findGroupKeyByForwardRequestId: (requestId: string) => string | undefined;
  bumpPreviewEpoch: (key: string) => void;
  reset: () => void;
}

export const usePanelGroupStore = create<PanelGroupStore>((set, get) => ({
  groups: {},
  previewEpochs: {},

  ensureGroup: (key) => {
    const existing = get().groups[key];
    if (existing) return existing;
    const group = emptyPanelGroup();
    set((s) => ({ groups: { ...s.groups, [key]: group } }));
    return group;
  },

  patchGroup: (key, patch) => {
    set((s) => {
      const current = s.groups[key] ?? emptyPanelGroup();
      const nextPatch = typeof patch === "function" ? patch(current) : patch;
      return {
        groups: { ...s.groups, [key]: { ...current, ...nextPatch } },
      };
    });
  },

  migrateGroup: (fromKey, toKey) => {
    const from = get().groups[fromKey];
    if (!from) return;
    set((s) => {
      const next = { ...s.groups, [toKey]: from };
      delete next[fromKey];
      return { groups: next };
    });
  },

  pruneGroups: (keepKeys) => {
    set((s) => {
      const groups: Record<string, PanelGroupState> = {};
      for (const [key, group] of Object.entries(s.groups)) {
        if (keepKeys.has(key)) groups[key] = group;
      }
      const previewEpochs: Record<string, number> = {};
      for (const [key, epoch] of Object.entries(s.previewEpochs)) {
        if (keepKeys.has(key)) previewEpochs[key] = epoch;
      }
      return { groups, previewEpochs };
    });
  },

  findGroupKeyByForwardRequestId: (requestId) => {
    for (const [key, group] of Object.entries(get().groups)) {
      if (group.forward?.requestId === requestId) return key;
    }
    return undefined;
  },

  bumpPreviewEpoch: (key) => {
    set((s) => ({
      previewEpochs: {
        ...s.previewEpochs,
        [key]: (s.previewEpochs[key] ?? 0) + 1,
      },
    }));
  },

  reset: () => set({ groups: {}, previewEpochs: {} }),
}));

export function prunePanelGroupCache(keepKeys: Set<string>): void {
  usePanelGroupStore.getState().pruneGroups(keepKeys);
}

export function nextActivePanelAfterClose(
  checked: DesktopPanelKind[],
  closed: DesktopPanelKind,
  active: DesktopPanelKind | null,
): DesktopPanelKind | null {
  if (active !== closed) return active;
  return firstPanelTab(checked.filter((k) => k !== closed));
}

export interface PanelGroupView extends PanelGroupState {
  previewEpoch: number;
}

/** Subscribe to one session's panel group + preview remount epoch. */
export function usePanelGroup(groupKey: string | undefined): PanelGroupView {
  return usePanelGroupStore(
    useShallow((s) => {
      const group = resolvePanelGroup(s.groups, groupKey);
      return {
        ...group,
        previewEpoch: groupKey ? (s.previewEpochs[groupKey] ?? 0) : 0,
      };
    }),
  );
}
