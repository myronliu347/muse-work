import type { FileViewState } from "../types";

/**
 * VS Code preview-tab semantics for the file panel. Invariants:
 * - At most one unpinned (preview) tab exists at any time.
 * - Opening a file that is not open replaces the existing preview tab in
 *   place (keeping its position) or appends one when no preview exists.
 * - Opening a file that is already open activates it; re-clicking the same
 *   path keeps the soft-refresh semantics (loading set, old content kept
 *   until the host reply lands).
 */

export interface FileTabsState {
  fileTabs: FileViewState[];
  activeFilePath: string | null;
}

export function emptyFileTabsState(): FileTabsState {
  return { fileTabs: [], activeFilePath: null };
}

/** Open `path`: activate if already open (soft refresh), else enter a
 * preview tab — replacing the current preview tab in place, or appending.
 * With `pinned`, a new file opens straight into a permanent tab (appended,
 * never occupying the preview slot) and an already-open file gets pinned. */
export function openFileTab(
  state: FileTabsState,
  path: string,
  host: string,
  opts?: { startLine?: number; endLine?: number; pinned?: boolean },
): FileTabsState {
  const existingIdx = state.fileTabs.findIndex((t) => t.path === path);
  if (existingIdx >= 0) {
    return {
      fileTabs: state.fileTabs.map((t, i) =>
        i === existingIdx
          ? {
              ...t,
              loading: true,
              startLine: opts?.startLine,
              endLine: opts?.endLine,
              ...(opts?.pinned ? { pinned: true } : {}),
            }
          : t,
      ),
      activeFilePath: path,
    };
  }
  const newTab: FileViewState = {
    path,
    host,
    loading: true,
    startLine: opts?.startLine,
    endLine: opts?.endLine,
    ...(opts?.pinned ? { pinned: true } : {}),
  };
  // Pinned opens are permanent tabs: append them instead of consuming the
  // preview slot (the existing preview, if any, stays replaceable).
  if (opts?.pinned) {
    return { fileTabs: [...state.fileTabs, newTab], activeFilePath: path };
  }
  const previewIdx = state.fileTabs.findIndex((t) => !t.pinned);
  if (previewIdx >= 0) {
    return {
      fileTabs: state.fileTabs.map((t, i) => (i === previewIdx ? newTab : t)),
      activeFilePath: path,
    };
  }
  return { fileTabs: [...state.fileTabs, newTab], activeFilePath: path };
}

/** Activate an existing tab. No-op when the path is not open. */
export function selectFileTab(
  state: FileTabsState,
  path: string,
): FileTabsState {
  if (state.activeFilePath === path) return state;
  if (!state.fileTabs.some((t) => t.path === path)) return state;
  return { ...state, activeFilePath: path };
}

/** Close a tab; closing the active one activates the left neighbor, else the
 * right one, else null (all closed → placeholder). */
export function closeFileTab(
  state: FileTabsState,
  path: string,
): FileTabsState {
  const idx = state.fileTabs.findIndex((t) => t.path === path);
  if (idx < 0) return state;
  const nextTabs = state.fileTabs.filter((t) => t.path !== path);
  if (state.activeFilePath !== path) {
    return { fileTabs: nextTabs, activeFilePath: state.activeFilePath };
  }
  const nextActive = nextTabs[idx - 1]?.path ?? nextTabs[idx]?.path ?? null;
  return { fileTabs: nextTabs, activeFilePath: nextActive };
}

/** Pin a preview tab so it is no longer replaced. No-op when already pinned. */
export function pinFileTab(
  state: FileTabsState,
  path: string,
): FileTabsState {
  const idx = state.fileTabs.findIndex((t) => t.path === path);
  if (idx < 0 || state.fileTabs[idx].pinned) return state;
  return {
    fileTabs: state.fileTabs.map((t, i) =>
      i === idx ? { ...t, pinned: true } : t,
    ),
    activeFilePath: state.activeFilePath,
  };
}

/**
 * Host `desktopFileContent` reply: fill the tab for `incoming.path`, keeping
 * its position and pin state; build one and activate it when no tab exists
 * (e.g. a write-tool preview opened without going through handleOpenFile).
 * `requestedPath` is the path the webview used for the loading stub (often a
 * relative link); when it differs from `incoming.path`, that stub is replaced.
 */
export function upsertFileContentTab(
  state: FileTabsState,
  incoming: FileViewState,
  requestedPath?: string,
): FileTabsState {
  const matchPath =
    requestedPath && state.fileTabs.some((t) => t.path === requestedPath)
      ? requestedPath
      : incoming.path;
  const idx = state.fileTabs.findIndex((t) => t.path === matchPath);
  if (idx >= 0) {
    return {
      fileTabs: state.fileTabs.map((t, i) =>
        i === idx ? { ...incoming, pinned: t.pinned } : t,
      ),
      activeFilePath:
        state.activeFilePath === matchPath
          ? incoming.path
          : state.activeFilePath,
    };
  }
  return {
    fileTabs: [...state.fileTabs, { ...incoming, pinned: false }],
    activeFilePath: incoming.path,
  };
}
