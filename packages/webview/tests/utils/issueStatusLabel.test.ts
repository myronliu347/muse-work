import { describe, expect, it } from "vitest";
import {
  issueGroupActivity,
  issueSessionBusy,
} from "../../src/components/session/SessionStatusGlyph";
import { issueSidebarStatusLabel } from "../../src/utils/issueStatusLabel";
import type { DesktopIssueGroup } from "../../src/types";

describe("issueSidebarStatusLabel", () => {
  it("follows the session for single mode and keeps split labels", () => {
    expect(
      issueSidebarStatusLabel({ status: "planning", agentMode: "single" }),
    ).toBe("空闲");
    expect(
      issueSidebarStatusLabel({
        status: "planning",
        agentMode: "single",
        running: true,
      }),
    ).toBe("进行中");
    expect(
      issueSidebarStatusLabel({
        status: "planning",
        agentMode: "single",
        sessionStatus: "error",
      }),
    ).toBe("失败");
    expect(
      issueSidebarStatusLabel({ status: "awaiting_close", agentMode: "single" }),
    ).toBe("待关闭");
    expect(issueSidebarStatusLabel({ status: "planning", agentMode: "split" })).toBe(
      "规划中",
    );
    expect(issueSidebarStatusLabel({ status: "executing" })).toBe("执行中");
  });
});

function group(partial: Partial<DesktopIssueGroup> & Pick<DesktopIssueGroup, "issueId">): DesktopIssueGroup {
  return {
    title: partial.issueId,
    priority: "p1",
    status: "planning",
    items: [],
    sessions: [],
    ...partial,
  };
}

describe("issueGroupActivity", () => {
  const session = {
    sessionId: "s1",
    title: "s",
    lastActiveAt: 1,
    hasWorktree: false,
  };

  it("prefers waiting, then running, then unread", () => {
    expect(
      issueGroupActivity(
        group({
          issueId: "a",
          agentMode: "single",
          sessions: [{ ...session, waitingConfirmation: true, running: true }],
        }),
      ).presence,
    ).toBe("waiting");
    expect(
      issueGroupActivity(
        group({
          issueId: "a",
          agentMode: "single",
          sessions: [{ ...session, running: true }],
        }),
      ),
    ).toMatchObject({ presence: "running", label: "进行中" });
    expect(
      issueGroupActivity(
        group({
          issueId: "a",
          sessions: [{ ...session, unreadDone: true }],
        }),
        { currentSessionId: "s1" },
      ).presence,
    ).toBeNull();
    expect(
      issueGroupActivity(
        group({
          issueId: "a",
          sessions: [{ ...session, unreadDone: true }],
        }),
      ).presence,
    ).toBe("unread");
  });

  it("treats the open session as busy only while it is generating", () => {
    const issue = group({
      issueId: "a",
      sessions: [{ ...session, running: true }],
    });
    expect(issueSessionBusy(issue, "s1", {})).toBe(true);
    expect(issueSessionBusy(issue, "other", { currentSessionId: "other", isStreaming: true })).toBe(
      true,
    );
    expect(
      issueSessionBusy(
        group({
          issueId: "a",
          sessions: [{ ...session, running: true, waitingConfirmation: true }],
        }),
        "s1",
        {},
      ),
    ).toBe(false);
  });
});
