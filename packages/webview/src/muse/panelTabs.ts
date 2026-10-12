import type { DesktopPanelKind } from "../types";

export const PANEL_TAB_ORDER: DesktopPanelKind[] = [
  "preview",
  "diff",
  "terminal",
  "file",
];

export const PANEL_TAB_LABELS: Record<DesktopPanelKind, string> = {
  preview: "浏览器",
  diff: "变更",
  terminal: "终端",
  file: "文件",
};

export const PANEL_TAB_ICONS: Record<DesktopPanelKind, string> = {
  preview: "codicon-globe",
  diff: "codicon-diff",
  terminal: "codicon-terminal",
  file: "codicon-file",
};

/** Order for the dock "+" add menu: 文件、终端、浏览器、变更. */
export const PANEL_ADD_ORDER: DesktopPanelKind[] = [
  "file",
  "terminal",
  "preview",
  "diff",
];

/** First panel the dock toggle opens. Sessions open 变更; a dock that hides
 * 变更 opens the first remaining add-menu item. */
export function defaultDockKind(
  disabled: readonly DesktopPanelKind[] = [],
): DesktopPanelKind | null {
  if (!disabled.includes("diff")) return "diff";
  return PANEL_ADD_ORDER.find((kind) => !disabled.includes(kind)) ?? null;
}

export type CollapsedTabs = {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
};

export function snapshotCollapsedTabs(
  checked: DesktopPanelKind[],
  active: DesktopPanelKind | null,
): CollapsedTabs | null {
  if (checked.length === 0) return null;
  const safeActive =
    active && checked.includes(active) ? active : firstPanelTab(checked);
  return { checked: [...checked], active: safeActive };
}

export function resolveOpenDockTabs(
  collapsed: CollapsedTabs | null | undefined,
): { checked: DesktopPanelKind[]; active: DesktopPanelKind } {
  if (!collapsed || collapsed.checked.length === 0) {
    return { checked: ["diff"], active: "diff" };
  }
  const active =
    collapsed.active && collapsed.checked.includes(collapsed.active)
      ? collapsed.active
      : (firstPanelTab(collapsed.checked) as DesktopPanelKind);
  return { checked: [...collapsed.checked], active };
}

export function firstPanelTab(
  checked: DesktopPanelKind[],
): DesktopPanelKind | null {
  return PANEL_TAB_ORDER.find((kind) => checked.includes(kind)) ?? null;
}

/** After closing `closing`, which tab should stay selected. */
export function nextActivePanel(
  checked: DesktopPanelKind[],
  closing: DesktopPanelKind,
  current: DesktopPanelKind | null,
): DesktopPanelKind | null {
  const remaining = checked.filter((k) => k !== closing);
  if (remaining.length === 0) return null;
  if (current && current !== closing && remaining.includes(current)) {
    return current;
  }
  const start = PANEL_TAB_ORDER.indexOf(closing);
  const from = start < 0 ? 0 : start;
  for (let i = 1; i <= PANEL_TAB_ORDER.length; i++) {
    const kind = PANEL_TAB_ORDER[(from + i) % PANEL_TAB_ORDER.length];
    if (remaining.includes(kind)) return kind;
  }
  return remaining[0] ?? null;
}
