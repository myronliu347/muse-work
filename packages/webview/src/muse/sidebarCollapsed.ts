export const DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY =
  "muse.desktopSidebarCollapsed";

const listeners = new Set<() => void>();
let current: boolean | undefined;

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(
      DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY,
    ) === "1";
  } catch {
    return false;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function getDesktopSidebarCollapsed(): boolean {
  if (current === undefined) current = readStored();
  return current;
}

export function subscribeDesktopSidebarCollapsed(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDesktopSidebarCollapsed(collapsed: boolean): void {
  if (collapsed === getDesktopSidebarCollapsed()) return;
  current = collapsed;
  try {
    globalThis.localStorage?.setItem(
      DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    /* private mode / blocked storage */
  }
  emit();
}

export function toggleDesktopSidebarCollapsed(): void {
  setDesktopSidebarCollapsed(!getDesktopSidebarCollapsed());
}

/** Test helper. */
export function resetDesktopSidebarCollapsed(): void {
  current = false;
  try {
    globalThis.localStorage?.removeItem(
      DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY,
    );
  } catch {
    /* ignore */
  }
  emit();
}
