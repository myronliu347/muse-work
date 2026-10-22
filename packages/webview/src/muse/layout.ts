/** Fixed icon-rail width. Chat content is padded by this on the leftmost pane. */
export const DESKTOP_SIDEBAR_WIDTH = 52;

/** Narrowest the overlay sidebar can be dragged. */
export const DESKTOP_SIDEBAR_MIN_WIDTH = 180;

/** Widest the overlay sidebar can be dragged. */
export const DESKTOP_SIDEBAR_MAX_WIDTH = 400;

/** Usable conversation column, excluding overlay-sidebar padding. */
export const CHAT_CONTENT_MIN_WIDTH = 520;

/** Minimum width of a split-view pane before overlay-sidebar padding. */
export const MIN_PANE_WIDTH = 360;

/** Preferred minimum dock width when the window has room. */
export const PANEL_MIN_WIDTH = 320;

export function clampSidebarWidth(width: number): number {
  return Math.min(
    DESKTOP_SIDEBAR_MAX_WIDTH,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, width),
  );
}

export function chatMainMinWidth(
  sidebarInset: boolean,
  sidebarWidth: number = DESKTOP_SIDEBAR_WIDTH,
): number {
  return CHAT_CONTENT_MIN_WIDTH + (sidebarInset ? sidebarWidth : 0);
}

export function minPaneWidth(
  firstInRow: boolean,
  sidebarWidth: number = DESKTOP_SIDEBAR_WIDTH,
): number {
  return MIN_PANE_WIDTH + (firstInRow ? sidebarWidth : 0);
}

/**
 * Clamp dock width into [min, maxWidth] where min is PANEL_MIN_WIDTH when
 * there is room, otherwise maxWidth itself — so min never exceeds max.
 */
export function clampDockWidth(width: number, maxWidth: number): number {
  if (!(maxWidth > 0)) return 0;
  const min = Math.min(PANEL_MIN_WIDTH, maxWidth);
  return Math.min(maxWidth, Math.max(min, width));
}

export function paneHasSidebarInset(
  panes:
    | Array<{ paneId: string; row?: number }>
    | undefined,
  paneId: string | undefined,
): boolean {
  if (!panes || panes.length === 0 || paneId === undefined) return true;
  const pane = panes.find((p) => p.paneId === paneId);
  if (!pane) return true;
  const row = pane.row === 1 ? 1 : 0;
  const first = panes.find((p) => (p.row === 1 ? 1 : 0) === row);
  return first?.paneId === paneId;
}
