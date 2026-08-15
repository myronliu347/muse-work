import { describe, expect, it } from "vitest";
import {
  defaultDockWidth,
  planPanelWidthsForOpen,
} from "../../src/muse/panelFit";
import type { DesktopPanelKind } from "../../src/types";

const defaults: Record<DesktopPanelKind, number> = {
  preview: 420,
  diff: 420,
  terminal: 420,
  file: 420,
};

describe("defaultDockWidth", () => {
  it("returns half the column width", () => {
    expect(defaultDockWidth(1400)).toBe(700);
    expect(defaultDockWidth(1024)).toBe(512);
  });

  it("never goes below the panel minimum", () => {
    expect(defaultDockWidth(500, 320)).toBe(320);
  });
});

describe("planPanelWidthsForOpen", () => {
  it("refuses when even min widths cannot fit", () => {
    const result = planPanelWidthsForOpen(
      500,
      [],
      defaults,
      "diff",
      { panelMin: 320, chatMin: 360 },
    );
    // 320 + 360 = 680 > 500
    expect(result.ok).toBe(false);
  });

  it("keeps widths when they already fit", () => {
    const result = planPanelWidthsForOpen(
      1000,
      [],
      defaults,
      "terminal",
      { panelMin: 320, chatMin: 360 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.widths.terminal).toBe(420);
    }
  });

  it("shrinks open panels so a fourth panel can open", () => {
    // 3×420 + 420 + 360 = 2040 needed at defaults; container 1700 fits 4×320+360.
    const result = planPanelWidthsForOpen(
      1700,
      ["preview", "diff", "file"],
      defaults,
      "terminal",
      { panelMin: 320, chatMin: 360 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sum =
      result.widths.preview +
      result.widths.diff +
      result.widths.file +
      result.widths.terminal;
    expect(sum).toBeLessThanOrEqual(1700 - 360);
    for (const k of ["preview", "diff", "file", "terminal"] as const) {
      expect(result.widths[k]).toBeGreaterThanOrEqual(320);
    }
  });
});
