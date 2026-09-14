import {
  DESKTOP_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from "./layout";

export const DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY = "muse.desktopSidebarWidth";

const listeners = new Set<() => void>();
let current: number | undefined;

function readStoredSidebarWidth(): number {
  try {
    const raw = globalThis.localStorage?.getItem(
      DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY,
    );
    if (raw == null || raw === "") return DESKTOP_SIDEBAR_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DESKTOP_SIDEBAR_WIDTH;
    return clampSidebarWidth(parsed);
  } catch {
    return DESKTOP_SIDEBAR_WIDTH;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function getDesktopSidebarWidth(): number {
  if (current === undefined) current = readStoredSidebarWidth();
  return current;
}

export function subscribeDesktopSidebarWidth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDesktopSidebarWidth(width: number): void {
  const next = clampSidebarWidth(width);
  if (next === getDesktopSidebarWidth()) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(
      DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY,
      String(next),
    );
  } catch {
    /* private mode / blocked storage */
  }
  emit();
}

/** Test helper: restore the default width and drop persisted value. */
export function resetDesktopSidebarWidth(): void {
  current = DESKTOP_SIDEBAR_WIDTH;
  try {
    globalThis.localStorage?.removeItem(DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}
