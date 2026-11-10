import type { FileViewState } from "../types";

/**
 * VS Code preview-tab semantics for the file panel. Invariants:
 * - At most one unpinned (preview) tab exists at any time.
 * - Opening a file that is not open replaces the existing preview tab in
 *   place (keeping its position) or appends one when no preview exists.
 * - Opening a file that is already open activates it. A relative link matches
 *   the absolute tab of the same file instead of inserting a second one.
 *   Content that is already on screen stays put, so the tab does not flash
 *   back through the loading placeholder.
 */

export interface FileTabsState {
  fileTabs: FileViewState[];
  activeFilePath: string | null;
}

export function emptyFileTabsState(): FileTabsState {
  return { fileTabs: [], activeFilePath: null };
}

/** Identity used as the dock tab key. Stable across path canonicalization. */
export function fileTabIdentity(tab: { path: string; tabKey?: string }): string {
  return tab.tabKey ?? tab.path;
}

const normalizePath = (p: string) => p.replace(/\\/g, "/");

/**
 * Higher is a better match. Exact wins. A relative link matches an open
 * absolute tab only when the relative path is a directory suffix, so
 * `src/App.tsx` hits `/work/src/App.tsx` and not every `App.tsx`.
 */
function fileMatchScore(candidate: string, requested: string): number {
  const a = normalizePath(candidate);
  const b = normalizePath(requested);
  if (!a || !b) return 0;
  if (a === b) return 1_000_000 + a.length;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (shorter.includes("/") && longer.endsWith(`/${shorter}`)) return shorter.length;
  return 0;
}

function findFileTabIndex(tabs: FileViewState[], requested: string): number {
  let best = -1;
  let bestScore = 0;
  tabs.forEach((tab, index) => {
    const score = Math.max(
      fileMatchScore(tab.path, requested),
      tab.tabKey ? fileMatchScore(tab.tabKey, requested) : 0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
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
  const existingIdx = findFileTabIndex(state.fileTabs, path);
  if (existingIdx >= 0) {
    const current = state.fileTabs[existingIdx];
    return {
      fileTabs: state.fileTabs.map((t, i) =>
        i === existingIdx
          ? {
              ...t,
              // Keep the loaded body. Clearing it for a soft refresh is what
              // makes the tab flash when a link is clicked again.
              loading: t.content === undefined && !t.imageBase64 && !t.error,
              startLine: opts?.startLine,
              endLine: opts?.endLine,
              tabKey: t.tabKey ?? t.path,
              ...(opts?.pinned ? { pinned: true } : {}),
            }
          : t,
      ),
      activeFilePath: current.path,
    };
  }
  const newTab: FileViewState = {
    path,
    host,
    loading: true,
    tabKey: path,
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
  const idx = state.fileTabs.findIndex(
    (t) => t.path === path || t.tabKey === path,
  );
  if (idx < 0) return state;
  const resolved = state.fileTabs[idx].path;
  if (state.activeFilePath === resolved) return state;
  return { ...state, activeFilePath: resolved };
}

/** Close a tab; closing the active one activates the left neighbor, else the
 * right one, else null (all closed → placeholder). */
export function closeFileTab(
  state: FileTabsState,
  path: string,
): FileTabsState {
  const idx = state.fileTabs.findIndex(
    (t) => t.path === path || t.tabKey === path,
  );
  if (idx < 0) return state;
  const resolved = state.fileTabs[idx].path;
  const nextTabs = state.fileTabs.filter((t) => t.path !== resolved);
  if (state.activeFilePath !== resolved) {
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
    const prev = state.fileTabs[idx];
    const nextTab: FileViewState = {
      ...incoming,
      pinned: prev.pinned,
      tabKey: prev.tabKey ?? prev.path,
    };
    const replaced = state.fileTabs.map((t, i) => (i === idx ? nextTab : t));
    // A link opened against an already-absolute tab must not leave a second
    // copy once the host resolves the same file.
    const fileTabs = replaced.filter(
      (t) => t === nextTab || t.path !== nextTab.path,
    );
    const wasActive =
      state.activeFilePath === matchPath ||
      state.activeFilePath === prev.path ||
      state.activeFilePath === nextTab.path;
    return {
      fileTabs,
      activeFilePath: wasActive ? nextTab.path : state.activeFilePath,
    };
  }
  return {
    fileTabs: [
      ...state.fileTabs,
      {
        ...incoming,
        pinned: false,
        tabKey: requestedPath ?? incoming.path,
      },
    ],
    activeFilePath: incoming.path,
  };
}
