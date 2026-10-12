import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { firstPanelTab, type CollapsedTabs } from "../muse/panelTabs";
import { emptyFileTabsState } from "../muse/fileTabs";
import type {
  DesktopPanelKind,
  FileSidebarMode,
  ContentSearchState,
  FileTreeDirEntry,
  FileTreeState,
  FileViewState,
  DiffViewState,
} from "../types";

export const PANEL_DEFAULT_WIDTH = 420;

export const FILE_TREE_WIDTH_MIN = 180;
export const FILE_TREE_WIDTH_MAX = 420;
export const FILE_TREE_WIDTH_DEFAULT = 240;

export function clampFileTreeWidth(width: number): number {
  return Math.min(FILE_TREE_WIDTH_MAX, Math.max(FILE_TREE_WIDTH_MIN, width));
}

export function emptyFileTreeState(): FileTreeState {
  return {
    expanded: [],
    selected: undefined,
    width: FILE_TREE_WIDTH_DEFAULT,
    childrenCache: {},
    collapsed: true,
  };
}

export function emptyContentSearchState(): ContentSearchState {
  return {
    query: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    results: [],
    expandedFiles: [],
    loading: false,
  };
}

/** Normalize slashes and ensure path is under workdir; return relative POSIX path or null. */
function relativeUnderWorkdir(
  workdir: string,
  fileAbsPath: string,
): string | null {
  const wd = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = fileAbsPath.replace(/\\/g, "/");
  if (file === wd) return "";
  if (!file.startsWith(wd + "/")) return null;
  return file.slice(wd.length + 1);
}

/**
 * Merge ancestor dirs of `fileAbsPath` into `expanded` and set `selected`.
 * Outside workdir: only updates selected.
 */
export function ensureExpandedForFile(
  tree: FileTreeState,
  workdir: string,
  fileAbsPath: string,
): FileTreeState {
  const rel = relativeUnderWorkdir(workdir, fileAbsPath);
  if (rel === null) {
    return { ...tree, selected: fileAbsPath };
  }
  const parts = rel.split("/").filter(Boolean);
  // Drop filename — expand ancestor directories only
  const dirs = parts.slice(0, -1);
  const toAdd: string[] = [];
  let acc = "";
  for (const part of dirs) {
    acc = acc ? `${acc}/${part}` : part;
    toAdd.push(acc);
  }
  const expanded = Array.from(new Set([...tree.expanded, ...toAdd]));
  return { ...tree, expanded, selected: fileAbsPath };
}

/**
 * Patch to release the large payloads a panel kind holds (file contents up to
 * 2MB, content-search results, diff snapshots) when its tab is closed. The
 * group stays keyed by workdir, so without releasing here the payloads would
 * stay pinned in memory for the lifetime of the workdir.
 */
export function releasePanelContent(
  group: PanelGroupState,
  kind: DesktopPanelKind,
): Partial<PanelGroupState> {
  if (kind === "file") {
    return {
      ...emptyFileTabsState(),
      contentSearch: emptyContentSearchState(),
    };
  }
  if (kind === "diff") {
    return { diffView: null };
  }
  return {};
}

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
  /** Last open tabs when the dock was collapsed via toggle / last-tab close. */
  collapsedTabs: CollapsedTabs | null;
  /** Dock covers the chat column; cleared when the dock closes. */
  dockFullscreen: boolean;
  previewUrl: string | null;
  /** Open file tabs (opening order) — see muse/fileTabs.ts for semantics. */
  fileTabs: FileViewState[];
  /** Path of the tab rendered in the file pane (null → placeholder). */
  activeFilePath: string | null;
  diffView: DiffViewState | null;
  fileTree: FileTreeState;
  fileSidebarMode: FileSidebarMode;
  contentSearch: ContentSearchState;
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
    collapsedTabs: null,
    dockFullscreen: false,
    previewUrl: null,
    fileTabs: [],
    activeFilePath: null,
    diffView: null,
    fileTree: emptyFileTreeState(),
    fileSidebarMode: "tree",
    contentSearch: emptyContentSearchState(),
    forward: null,
    forwardError: null,
  };
}

const EMPTY_GROUP = emptyPanelGroup();

export function workdirTermId(workdir: string): string {
  return `term-wd-${encodeURIComponent(workdir.trim())}`;
}

/** Assistant dock is not a workdir, so session-tree pruning must keep this key. */
export const ASSISTANT_PANEL_GROUP_KEY = "assistant";

export function isDraftGroupKey(groupKey: string | undefined): boolean {
  if (!groupKey) return true;
  return groupKey === "__draft__" || groupKey.startsWith("new:");
}

export function resolvePanelGroup(
  groups: Record<string, PanelGroupState>,
  groupKey: string | undefined,
): PanelGroupState {
  if (!groupKey || isDraftGroupKey(groupKey)) return EMPTY_GROUP;
  const group = groups[groupKey];
  if (!group) return EMPTY_GROUP;
  // Back-compat for in-memory groups created before newer fields existed
  let next = group;
  if (!next.fileTree) {
    next = { ...next, fileTree: emptyFileTreeState() };
  } else if (next.fileTree.collapsed === undefined) {
    next = {
      ...next,
      fileTree: { ...next.fileTree, collapsed: true },
    };
  }
  if (!next.fileSidebarMode) {
    next = { ...next, fileSidebarMode: "tree" };
  }
  if (!next.contentSearch) {
    next = { ...next, contentSearch: emptyContentSearchState() };
  }
  if (next.collapsedTabs === undefined) {
    next = { ...next, collapsedTabs: null };
  }
  if (next.dockFullscreen === undefined) {
    next = { ...next, dockFullscreen: false };
  }
  return next;
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
  pruneGroups: (keepKeys: Set<string>) => string[];
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
    const s = get();
    const removed: string[] = [];
    const groups: Record<string, PanelGroupState> = {};
    for (const [key, group] of Object.entries(s.groups)) {
      if (keepKeys.has(key)) groups[key] = group;
      else removed.push(key);
    }
    const previewEpochs: Record<string, number> = {};
    for (const [key, epoch] of Object.entries(s.previewEpochs)) {
      if (keepKeys.has(key)) previewEpochs[key] = epoch;
    }
    set({ groups, previewEpochs });
    return removed;
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

export function prunePanelGroupCache(keepKeys: Set<string>): string[] {
  return usePanelGroupStore.getState().pruneGroups(keepKeys);
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

export type { FileTreeDirEntry, FileTreeState, FileSidebarMode, ContentSearchState, DiffViewState };
