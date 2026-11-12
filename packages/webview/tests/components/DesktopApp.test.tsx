/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { resetWebviewStores } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  usePanelGroupStore,
  workdirTermId,
} from "../../src/stores/panelGroupStore";
import type { DesktopSessionEntry, VsCodeApi } from "../../src/types";

function mockVscode(): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: () => ({}),
    setState: vi.fn(),
  };
}

function entry(sessionId: string): DesktopSessionEntry {
  return {
    sessionId,
    title: sessionId,
    lastActiveAt: Date.now(),
    workdir: "/tmp/proj",
    hasWorktree: false,
  };
}

function postToWindow(data: unknown): void {
  fireEvent(window, new MessageEvent("message", { data }));
}

describe("DesktopApp host → sidebar 会话树", () => {
  it("keeps the assistant dock open across a session-tree refresh", () => {
    usePanelGroupStore.getState().reset();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file", "terminal"],
      mounted: ["file", "terminal"],
      active: "file",
    });
    const vscode = mockVscode();
    render(<DesktopApp vscode={vscode} />);
    postToWindow({
      command: "desktopSessionTree",
      groups: [
        {
          host: "local",
          workdir: "recent",
          sessions: [entry("sess-1")],
        },
      ],
      issueGroups: [],
      closedIssueGroups: [],
    });
    expect(
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.checked,
    ).toEqual(["file", "terminal"]);
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopTerminalKill" }),
    );
    usePanelGroupStore.getState().reset();
  });

  it("drops a closed issue workdir dock and keeps an open issue workdir", () => {
    resetWebviewStores();
    usePanelGroupStore.getState().reset();
    usePanelGroupStore.getState().patchGroup("/wt/closed", {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
    });
    usePanelGroupStore.getState().patchGroup("/wt/open", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const vscode = mockVscode();
    const { unmount } = render(<DesktopApp vscode={vscode} />);
    try {
      postToWindow({
        command: "desktopWorkdirState",
        workdir: "/tmp/proj",
        recentWorkdirs: ["/tmp/proj"],
        host: "local",
      });
      const session = (
        sessionId: string,
        workdir: string,
      ): DesktopSessionEntry => ({
        sessionId,
        title: sessionId,
        lastActiveAt: 1,
        workdir,
        hasWorktree: true,
      });
      postToWindow({
        command: "desktopSessionTree",
        groups: [],
        issueGroups: [
          {
            issueId: "open-1",
            title: "还在做",
            priority: "p1",
            status: "planning",
            items: [],
            sessions: [session("plan-open", "/wt/open")],
          },
        ],
        closedIssueGroups: [
          {
            issueId: "closed-1",
            title: "已经关了",
            priority: "p1",
            status: "completed",
            items: [],
            sessions: [session("plan-closed", "/wt/closed")],
          },
        ],
      });

      expect(usePanelGroupStore.getState().groups["/wt/closed"]).toBeUndefined();
      expect(usePanelGroupStore.getState().groups["/wt/open"]?.checked).toEqual([
        "terminal",
      ]);
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopTerminalKill",
        termId: workdirTermId("/wt/closed"),
      });
    } finally {
      unmount();
      resetWebviewStores();
      usePanelGroupStore.getState().reset();
    }
  });

  it("desktopSessionTree 推送后渲染工作空间会话", () => {
    const vscode = mockVscode();
    render(<DesktopApp vscode={vscode} />);
    expect(screen.getByTestId("desktop-loading")).toBeTruthy();

    postToWindow({
      command: "desktopWorkdirState",
      workdir: "/tmp/proj",
      recentWorkdirs: ["/tmp/proj"],
      host: "local",
    });
    postToWindow({
      command: "desktopSessionTree",
      groups: [
        {
          host: "local",
          workdir: "recent",
          sessions: [entry("sess-1")],
        },
      ],
    });

    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(screen.queryByTestId("desktop-session-item-sess-1")).toBeNull();

    fireEvent.click(screen.getByTestId("desktop-sessions-menu"));

    expect(screen.getByTestId("desktop-session-item-sess-1")).toBeTruthy();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
  });

  it("首屏没有 Issue 区，点开会话后仍不渲染 Issue", () => {
    const vscode = mockVscode();
    render(<DesktopApp vscode={vscode} />);

    postToWindow({
      command: "desktopWorkdirState",
      workdir: "/tmp/proj",
      recentWorkdirs: ["/tmp/proj"],
      host: "local",
    });
    postToWindow({
      command: "desktopSessionTree",
      groups: [
        {
          host: "local",
          workdir: "recent",
          sessions: [entry("sess-1")],
        },
      ],
      issueGroups: [
        {
          issueId: "issue-1",
          title: "侧栏 Issue",
          priority: "p2",
          type: "research",
          status: "pending",
          items: [],
          sessions: [entry("plan-1")],
        },
        {
          issueId: "legacy-1",
          title: "测试任务看板功能",
          status: "reviewing",
          items: [],
          sessions: [],
        },
      ],
    });

    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(screen.getByTestId("desktop-sidebar").textContent).not.toContain("侧栏 Issue");

    fireEvent.click(screen.getByTestId("desktop-sessions-menu"));

    const sessionList = screen.getByTestId("desktop-session-list");
    expect(screen.getByTestId("desktop-session-item-sess-1")).toBeTruthy();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(sessionList.textContent).not.toContain("侧栏 Issue");
    expect(sessionList.textContent).not.toContain("测试任务看板功能");
  });

});
