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

export function filesReferToSame(
  a: { path: string; tabKey?: string },
  b: { path: string; tabKey?: string },
): boolean {
  const left = [a.path, a.tabKey].filter((value): value is string => Boolean(value));
  const right = [b.path, b.tabKey].filter((value): value is string => Boolean(value));
  return left.some((one) => right.some((other) => fileMatchScore(one, other) > 0));
}

/** First tab wins when two entries are the same file under different paths. */
export function uniqueFileTabs(tabs: FileViewState[]): FileViewState[] {
  const out: FileViewState[] = [];
  for (const tab of tabs) {
    if (out.some((item) => filesReferToSame(item, tab))) continue;
    out.push(tab);
  }
  return out;
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
function sameFileTab(a: FileViewState, b: FileViewState): boolean {
  return (
    a.path === b.path &&
    a.host === b.host &&
    a.tabKey === b.tabKey &&
    a.loading === b.loading &&
    a.error === b.error &&
    a.unsupported === b.unsupported &&
    a.sizeBytes === b.sizeBytes &&
    a.content === b.content &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.truncated === b.truncated &&
    a.totalLines === b.totalLines &&
    a.imageBase64 === b.imageBase64 &&
    a.pinned === b.pinned
  );
}

export function openFileTab(
  state: FileTabsState,
  path: string,
  host: string,
  opts?: { startLine?: number; endLine?: number; pinned?: boolean },
): FileTabsState {
  const existingIdx = findFileTabIndex(state.fileTabs, path);
  if (existingIdx >= 0) {
    const current = state.fileTabs[existingIdx];
    const nextTab: FileViewState = {
      ...current,
      // Keep the loaded body. Clearing it for a soft refresh is what
      // makes the tab flash when a link is clicked again.
      loading: current.content === undefined && !current.imageBase64 && !current.error,
      startLine: opts?.startLine,
      endLine: opts?.endLine,
      tabKey: current.tabKey ?? current.path,
      ...(opts?.pinned ? { pinned: true } : {}),
    };
    // A repeat open of the visible file must not allocate a new tab list.
    // An effect that opens whenever the list identity changes would otherwise
    // setState forever.
    if (state.activeFilePath === current.path && sameFileTab(current, nextTab)) {
      return state;
    }
    return {
      fileTabs: state.fileTabs.map((t, i) => (i === existingIdx ? nextTab : t)),
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
  const byRequest = requestedPath ? findFileTabIndex(state.fileTabs, requestedPath) : -1;
  const byIncoming = findFileTabIndex(state.fileTabs, incoming.path);
  const idx = byRequest >= 0 ? byRequest : byIncoming;
  if (idx >= 0) {
    const prev = state.fileTabs[idx];
    const nextTab: FileViewState = {
      ...incoming,
      pinned: prev.pinned,
      tabKey: prev.tabKey ?? prev.path,
    };
    const replaced = state.fileTabs.map((t, i) => (i === idx ? nextTab : t));
    // A link opened against an already-absolute tab must not leave a second
    // copy once the host resolves the same file. A relative stub and the
    // absolute reply are the same file even when the reply omits requestedPath.
    const fileTabs = replaced.filter(
      (t) => t === nextTab || !filesReferToSame(t, nextTab),
    );
    const wasActive =
      state.activeFilePath === requestedPath ||
      state.activeFilePath === prev.path ||
      state.activeFilePath === prev.tabKey ||
      state.activeFilePath === nextTab.path;
    const activeFilePath = wasActive ? nextTab.path : state.activeFilePath;
    if (
      fileTabs.length === state.fileTabs.length &&
      activeFilePath === state.activeFilePath &&
      sameFileTab(prev, nextTab)
    ) {
      return state;
    }
    return {
      fileTabs,
      activeFilePath,
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
