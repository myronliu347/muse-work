import type { DesktopPanelKind } from "../types";
import { PANEL_MIN_WIDTH } from "./layout";

export type PanelWidthMap = Record<DesktopPanelKind, number>;

/** Fraction of the chat column used when the dock first opens. */
export const PANEL_DEFAULT_RATIO = 0.5;

/**
 * Default dock width for a first open: half of `columnWidth` (the chat
 * column that hosts the dock), floored at `panelMin`.
 */
export function defaultDockWidth(
  columnWidth: number,
  panelMin = 320,
): number {
  return Math.max(panelMin, Math.round(columnWidth * PANEL_DEFAULT_RATIO));
}

/**
 * Widths for the dock's first open. Every kind shares one column, so they
 * all start at the same width. Returns null when even one panel cannot fit.
 */
export function firstOpenDockWidths(
  containerW: number,
  chatMin: number,
): PanelWidthMap | null {
  if (!(containerW > 0)) return null;
  const leftover = containerW - chatMin;
  const panelMin =
    leftover > 0 ? Math.min(PANEL_MIN_WIDTH, leftover) : PANEL_MIN_WIDTH;
  const desired = defaultDockWidth(containerW, panelMin);
  const base: PanelWidthMap = {
    preview: desired,
    diff: desired,
    terminal: desired,
    file: desired,
  };
  const planned = planPanelWidthsForOpen(containerW, [], base, "preview", {
    panelMin,
    chatMin,
  });
  return planned.ok ? planned.widths : null;
}

/**
 * Plan widths so `kind` can open beside `checked` panels without squeezing
 * the conversation below `chatMin`. Shrinks existing panels toward `panelMin`
 * when the default widths would overflow; returns refuse when even all-min
 * widths do not fit.
 */
export function planPanelWidthsForOpen(
  containerW: number,
  checked: DesktopPanelKind[],
  widths: PanelWidthMap,
  kind: DesktopPanelKind,
  opts: { panelMin: number; chatMin: number },
): { ok: true; widths: PanelWidthMap } | { ok: false } {
  const { panelMin, chatMin } = opts;
  const others = checked.filter((k) => k !== kind);
  const all = [...others, kind];
  if (containerW < all.length * panelMin + chatMin) {
    return { ok: false };
  }

  const available = containerW - chatMin;
  const next: PanelWidthMap = { ...widths };
  let sum = all.reduce((s, k) => s + next[k], 0);
  if (sum <= available) {
    return { ok: true, widths: next };
  }

  let excess = sum - available;
  // Proportionally take slack above panelMin until we fit.
  while (excess > 0) {
    const shrinkable = all.filter((k) => next[k] > panelMin);
    if (shrinkable.length === 0) return { ok: false };
    const totalSlack = shrinkable.reduce(
      (s, k) => s + (next[k] - panelMin),
      0,
    );
    if (totalSlack <= 0) return { ok: false };

    if (excess >= totalSlack) {
      for (const k of shrinkable) next[k] = panelMin;
      excess -= totalSlack;
      continue;
    }

    let cutTotal = 0;
    for (const k of shrinkable) {
      const slack = next[k] - panelMin;
      const cut = Math.floor((excess * slack) / totalSlack);
      next[k] -= cut;
      cutTotal += cut;
    }
    // Flooring can leave a remainder — shave 1px from panels still above min.
    let remainder = excess - cutTotal;
    for (const k of shrinkable) {
      if (remainder <= 0) break;
      if (next[k] > panelMin) {
        next[k] -= 1;
        remainder -= 1;
      }
    }
    excess = remainder;
  }

  return { ok: true, widths: next };
}
