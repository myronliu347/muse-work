import { describe, expect, it } from "vitest";
import {
  closeIssueTab,
  focusTab,
  initialBotWorkspace,
  openIssueSession,
  selectDock,
  selectPanel,
  sessionActionLabel,
} from "../../src/components/desktop/botWorkspace";

describe("botWorkspace", () => {
  it("opens on Muse Bot with the first issue only in the detail panel", () => {
    const state = initialBotWorkspace("radii");
    expect(state.active).toBe("bot");
    expect(state.openIssueIds).toEqual([]);
    expect(state.panel).toEqual({ kind: "issue", issueId: "radii" });
    expect(state.dock).toBe("detail");
    expect(state.lastIssueId).toBe("radii");
  });

  it("selecting a list item does not open or switch the center tab", () => {
    const opened = openIssueSession(initialBotWorkspace("radii"), "radii");
    const next = selectPanel(opened, { kind: "issue", issueId: "a11y" });
    expect(next.active).toBe("radii");
    expect(next.openIssueIds).toEqual(["radii"]);
    expect(next.panel).toEqual({ kind: "issue", issueId: "a11y" });
    expect(next.dock).toBe("detail");
    expect(next.lastIssueId).toBe("a11y");
  });

  it("selecting a queue item keeps the last issue for the tool tabs", () => {
    const next = selectPanel(initialBotWorkspace("radii"), {
      kind: "queue",
      id: "ty",
    });
    expect(next.panel).toEqual({ kind: "queue", id: "ty" });
    expect(next.dock).toBe("detail");
    expect(next.lastIssueId).toBe("radii");
    expect(next.active).toBe("bot");
  });

  it("open session adds a tab and leaves the dock tab alone", () => {
    const onFile = selectDock(initialBotWorkspace("radii"), "file");
    const next = openIssueSession(onFile, "radii");
    expect(next.active).toBe("radii");
    expect(next.openIssueIds).toEqual(["radii"]);
    expect(next.dock).toBe("file");
  });

  it("focus and close only change center tabs", () => {
    const opened = openIssueSession(
      openIssueSession(initialBotWorkspace("radii"), "radii"),
      "a11y",
    );
    expect(focusTab(opened, "bot").active).toBe("bot");
    expect(focusTab(opened, "bot").dock).toBe("detail");
    const closed = closeIssueTab(opened, "a11y");
    expect(closed.active).toBe("bot");
    expect(closed.openIssueIds).toEqual(["radii"]);
  });

  it("names the detail button from tab state", () => {
    const initial = initialBotWorkspace("radii");
    expect(sessionActionLabel(initial, "radii")).toBe("打开会话");
    const opened = openIssueSession(initial, "radii");
    expect(sessionActionLabel(focusTab(opened, "bot"), "radii")).toBe("切到会话");
    expect(sessionActionLabel(opened, "radii")).toBeNull();
  });
});
