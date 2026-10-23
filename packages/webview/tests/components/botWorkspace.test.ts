import { describe, expect, it } from "vitest";
import {
  closeIssueTab,
  focusTab,
  initialBotWorkspace,
  issueTabSessionId,
  openIssueSession,
  selectDock,
  selectPanel,
  sessionActionLabel,
} from "../../src/components/desktop/botWorkspace";
import type { DesktopIssueGroup } from "../../src/types";

function issueGroup(
  partial: Partial<DesktopIssueGroup> & Pick<DesktopIssueGroup, "issueId">,
): DesktopIssueGroup {
  return {
    title: partial.issueId,
    priority: "p1",
    status: "planning",
    items: [],
    sessions: [],
    ...partial,
  };
}

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
    expect(focusTab(opened, "bot").panel).toEqual(opened.panel);
    const focused = focusTab(opened, "radii");
    expect(focused.active).toBe("radii");
    expect(focused.panel).toEqual({ kind: "issue", issueId: "radii" });
    expect(focused.dock).toBe("detail");
    const closed = closeIssueTab(opened, "a11y");
    expect(closed.active).toBe("bot");
    expect(closed.openIssueIds).toEqual(["radii"]);
  });

  it("selecting an open issue from another issue tab focuses that tab", () => {
    const opened = openIssueSession(
      openIssueSession(initialBotWorkspace("radii"), "radii"),
      "a11y",
    );
    const next = selectPanel(opened, { kind: "issue", issueId: "radii" });
    expect(next.active).toBe("radii");
    expect(next.panel).toEqual({ kind: "issue", issueId: "radii" });
  });

  it("selecting an open issue from Muse Bot does not leave the home", () => {
    const opened = focusTab(
      openIssueSession(initialBotWorkspace("radii"), "radii"),
      "bot",
    );
    const next = selectPanel(opened, { kind: "issue", issueId: "radii" });
    expect(next.active).toBe("bot");
    expect(next.panel).toEqual({ kind: "issue", issueId: "radii" });
  });

  it("issueTabSessionId prefers an execution session over planning", () => {
    expect(
      issueTabSessionId(
        issueGroup({
          issueId: "radii",
          planningSessionId: "plan-radii",
          sessions: [
            {
              sessionId: "plan-radii",
              title: "圆角",
              lastActiveAt: 1,
              workdir: "/work/radii",
              hasWorktree: false,
            },
          ],
        }),
      ),
    ).toBe("plan-radii");

    expect(
      issueTabSessionId(
        issueGroup({
          issueId: "a11y",
          planningSessionId: "plan-a11y",
          executionSessionId: "exec-a11y",
          sessions: [
            {
              sessionId: "plan-a11y",
              title: "规划",
              lastActiveAt: 1,
              workdir: "/work/a11y-plan",
              hasWorktree: false,
            },
            {
              sessionId: "exec-a11y",
              title: "执行",
              lastActiveAt: 2,
              workdir: "/work/a11y-exec",
              hasWorktree: false,
            },
          ],
        }),
      ),
    ).toBe("exec-a11y");

    expect(
      issueTabSessionId(
        issueGroup({
          issueId: "notes",
          sessions: [
            {
              sessionId: "plan-from-list",
              title: "笔记",
              lastActiveAt: 1,
              workdir: "/work/notes",
              hasWorktree: false,
            },
          ],
        }),
      ),
    ).toBe("plan-from-list");

    expect(issueTabSessionId(issueGroup({ issueId: "empty", sessions: [] }))).toBeUndefined();
  });

  it("names the detail button from tab state", () => {
    const initial = initialBotWorkspace("radii");
    expect(sessionActionLabel(initial, "radii")).toBe("打开会话");
    const opened = openIssueSession(initial, "radii");
    expect(sessionActionLabel(focusTab(opened, "bot"), "radii")).toBe("切到会话");
    expect(sessionActionLabel(opened, "radii")).toBeNull();
  });
});
