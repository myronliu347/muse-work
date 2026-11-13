import { describe, expect, it } from "vitest";
import {
  botDockChromeChecked,
  botIssueChromeChecked,
  dockToolLabel,
  dockToolTitle,
  nextDockToolId,
  rebuildTerminalTool,
} from "../../src/muse/dockTools";
import type { DockToolInstance } from "../../src/stores/panelGroupStore";

function terminal(id: string, workdir: string): DockToolInstance {
  return { id, kind: "terminal", workdir };
}

describe("bot dock tools", () => {
  it("keeps file and diff on the issue and adds a terminal only from tools", () => {
    expect(
      botIssueChromeChecked(
        ["file", "terminal", "diff"],
        [terminal("t1", "/work/radii")],
      ),
    ).toEqual(["file", "diff", "terminal"]);
  });

  it("uses the page title on a browser tab", () => {
    const file = {
      id: "b1",
      kind: "preview" as const,
      previewUrl: "file:///tmp/proj/wave-agent-structure.html",
      pageTitle: "原型多端预览",
    };
    expect(dockToolLabel(file, [file])).toBe("原型多端预览");
    expect(dockToolTitle(file)).toBe("原型多端预览");
    const untitled = { ...file, pageTitle: null };
    expect(dockToolLabel(untitled, [untitled])).toBe("浏览器");
  });

  it("keeps a bot terminal selectable when no issue is current", () => {
    expect(
      botDockChromeChecked(false, [], [terminal("t1", "/tmp/proj")]),
    ).toEqual(["terminal"]);
  });

  it("labels a second terminal in the same directory", () => {
    const tools = [terminal("t1", "/work/radii"), terminal("t2", "/work/radii")];
    expect(dockToolLabel(tools[0], tools)).toBe("radii");
    expect(dockToolLabel(tools[1], tools)).toBe("radii 2");
  });

  it("focuses another terminal after the active one closes", () => {
    const tools = [terminal("t1", "/work/a"), terminal("t2", "/work/b")];
    expect(nextDockToolId(tools, "t2", "t2")).toBe("t1");
  });

  it("rebuilds a terminal tab in place with a fresh id and the current workdir", () => {
    const tools = [
      terminal("t1", "/work/quiet-river-739"),
      { id: "b1", kind: "preview" as const, previewUrl: "https://example.com" },
    ];
    const next = rebuildTerminalTool(tools, "t1", "/work/assistant-chat", "t9");
    expect(next).toEqual([
      { id: "t9", kind: "terminal", workdir: "/work/assistant-chat" },
      { id: "b1", kind: "preview", previewUrl: "https://example.com" },
    ]);
    // Other tabs and the original list are untouched.
    expect(tools[0].id).toBe("t1");
  });
});
