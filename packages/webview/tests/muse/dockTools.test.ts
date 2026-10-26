import { describe, expect, it } from "vitest";
import {
  botIssueChromeChecked,
  dockToolLabel,
  nextDockToolId,
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

  it("labels a second terminal in the same directory", () => {
    const tools = [terminal("t1", "/work/radii"), terminal("t2", "/work/radii")];
    expect(dockToolLabel(tools[0], tools)).toBe("radii");
    expect(dockToolLabel(tools[1], tools)).toBe("radii 2");
  });

  it("focuses another terminal after the active one closes", () => {
    const tools = [terminal("t1", "/work/a"), terminal("t2", "/work/b")];
    expect(nextDockToolId(tools, "t2", "t2")).toBe("t1");
  });
});
