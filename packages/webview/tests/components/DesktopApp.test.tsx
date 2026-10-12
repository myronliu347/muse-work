/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  usePanelGroupStore,
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

    expect(screen.getByTestId("desktop-session-item-sess-1")).toBeTruthy();
  });

  it("desktopSessionTree issueGroups 渲染待办事项与优先级徽标", () => {
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
      groups: [],
      issueGroups: [
        {
          issueId: "issue-1",
          title: "侧栏 Issue",
          priority: "p2",
          status: "pending",
          items: [],
          sessions: [entry("plan-1")],
        },
      ],
    });

    const section = screen.getByTestId("desktop-session-section-issues");
    expect(section).toHaveTextContent("待办事项");
    expect(section).toHaveTextContent("侧栏 Issue");
    const badge = section.querySelector(".issue-sidebar-priority-p2");
    expect(badge).toBeTruthy();
    expect(badge).toHaveTextContent("P2");
  });

  it("desktopSessionTree 缺少 priority 的遗留 Issue 不白屏", () => {
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
      groups: [],
      issueGroups: [
        {
          issueId: "legacy-1",
          title: "测试任务看板功能",
          status: "reviewing",
          items: [],
          sessions: [],
        },
      ],
    });

    expect(screen.getByTestId("desktop-session-section-issues")).toHaveTextContent(
      "测试任务看板功能",
    );
  });
});
