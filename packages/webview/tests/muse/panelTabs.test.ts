import { describe, expect, it } from "vitest";
import { nextActivePanel, PANEL_TAB_LABELS } from "../../src/muse/panelTabs";

describe("PANEL_TAB_LABELS", () => {
  it("uses 浏览器 / 变更 for preview and diff", () => {
    expect(PANEL_TAB_LABELS.preview).toBe("浏览器");
    expect(PANEL_TAB_LABELS.diff).toBe("变更");
    expect(PANEL_TAB_LABELS.terminal).toBe("终端");
    expect(PANEL_TAB_LABELS.file).toBe("文件");
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
