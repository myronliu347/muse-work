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
