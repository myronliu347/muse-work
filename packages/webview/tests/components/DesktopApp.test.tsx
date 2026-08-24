/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import type { DesktopSessionEntry, DesktopTodoGroup, VsCodeApi } from "../../src/types";

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

function todoGroup(): DesktopTodoGroup {
  return {
    todoId: "todo-1",
    todoTitle: "设计评审",
    priority: "p1",
    sessions: [entry("sess-plan"), entry("sess-exec")],
  };
}

function postToWindow(data: unknown): void {
  fireEvent(window, new MessageEvent("message", { data }));
}

describe("DesktopApp host → sidebar todoGroups 链路", () => {
  it("desktopSessionTree 携带 todoGroups 时侧栏任务 section 按 todo 分组渲染", () => {
    const vscode = mockVscode();
    render(<DesktopApp vscode={vscode} />);
    // 无 workdir 前处于 loading，不渲染布局
    expect(screen.getByTestId("desktop-loading")).toBeTruthy();

    postToWindow({
      command: "desktopWorkdirState",
      workdir: "/tmp/proj",
      recentWorkdirs: ["/tmp/proj"],
      host: "local",
    });
    postToWindow({
      command: "desktopSessionTree",
      groups: [],
      todoGroups: [todoGroup()],
    });

    const group = screen.getByTestId("desktop-session-todo-group-todo-1");
    expect(group).toBeTruthy();
    expect(screen.getByText("设计评审")).toBeTruthy();
    expect(screen.getByTestId("desktop-session-item-sess-plan")).toBeTruthy();
    expect(screen.getByTestId("desktop-session-item-sess-exec")).toBeTruthy();
  });
});
