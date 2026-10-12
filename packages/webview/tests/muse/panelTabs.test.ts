import { describe, expect, it } from "vitest";
import {
  defaultDockKind,
  nextActivePanel,
  PANEL_ADD_ORDER,
  PANEL_TAB_ICONS,
  PANEL_TAB_LABELS,
  resolveOpenDockTabs,
  snapshotCollapsedTabs,
} from "../../src/muse/panelTabs";

describe("PANEL_TAB_LABELS", () => {
  it("uses 浏览器 / 变更 for preview and diff", () => {
    expect(PANEL_TAB_LABELS.preview).toBe("浏览器");
    expect(PANEL_TAB_LABELS.diff).toBe("变更");
    expect(PANEL_TAB_LABELS.terminal).toBe("终端");
    expect(PANEL_TAB_LABELS.file).toBe("文件");
  });
});

describe("PANEL_TAB_ICONS", () => {
  it("maps each tab to a matching codicon", () => {
    expect(PANEL_TAB_ICONS.preview).toBe("codicon-globe");
    expect(PANEL_TAB_ICONS.diff).toBe("codicon-diff");
    expect(PANEL_TAB_ICONS.terminal).toBe("codicon-terminal");
    expect(PANEL_TAB_ICONS.file).toBe("codicon-file");
  });
});

describe("nextActivePanel", () => {
  it("returns null when closing the last tab", () => {
    expect(nextActivePanel(["diff"], "diff", "diff")).toBeNull();
  });

  it("keeps the current tab when closing a different one", () => {
    expect(
      nextActivePanel(["preview", "diff", "terminal"], "diff", "preview"),
    ).toBe("preview");
  });

  it("selects the next remaining tab in order when closing the active one", () => {
    expect(
      nextActivePanel(["preview", "diff", "terminal"], "diff", "diff"),
    ).toBe("terminal");
  });
});

describe("PANEL_ADD_ORDER", () => {
  it("lists 文件、终端、浏览器、变更", () => {
    expect(PANEL_ADD_ORDER).toEqual(["file", "terminal", "preview", "diff"]);
  });
});

describe("defaultDockKind", () => {
  it("opens 变更 for a session dock", () => {
    expect(defaultDockKind([])).toBe("diff");
  });

  it("opens 文件 when 变更 is hidden and a workdir exists", () => {
    expect(defaultDockKind(["diff"])).toBe("file");
  });

  it("opens 浏览器 when only the browser is available", () => {
    expect(defaultDockKind(["diff", "file", "terminal"])).toBe("preview");
  });
});

describe("snapshotCollapsedTabs / resolveOpenDockTabs", () => {
  it("returns null snapshot when nothing is open", () => {
    expect(snapshotCollapsedTabs([], null)).toBeNull();
  });

  it("snapshots checked + active for restore", () => {
    expect(snapshotCollapsedTabs(["preview", "file"], "file")).toEqual({
      checked: ["preview", "file"],
      active: "file",
    });
  });

  it("restores collapsed tabs", () => {
    expect(
      resolveOpenDockTabs({ checked: ["preview", "file"], active: "file" }),
    ).toEqual({ checked: ["preview", "file"], active: "file" });
  });

  it("defaults to 变更 when no collapsed history", () => {
    expect(resolveOpenDockTabs(null)).toEqual({
      checked: ["diff"],
      active: "diff",
    });
    expect(resolveOpenDockTabs({ checked: [], active: null })).toEqual({
      checked: ["diff"],
      active: "diff",
    });
  });

  it("falls back active to first remaining tab when stale", () => {
    expect(
      resolveOpenDockTabs({ checked: ["terminal"], active: "diff" }),
    ).toEqual({ checked: ["terminal"], active: "terminal" });
  });
});
