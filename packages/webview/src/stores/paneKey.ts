/** Stable key for per-pane UI state in zustand (split panes vs single view). */
export function paneStoreKey(paneId?: string): string {
  return paneId ?? "__single__";
}
