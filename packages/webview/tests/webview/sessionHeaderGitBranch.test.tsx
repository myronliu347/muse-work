/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { resetWebviewStores } from "../../src/stores";
import {
  sendCommand,
  sendHostMessage,
  renderDesktopApp,
  bootstrapDesktopAuth,
  fireInput,
} from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktop(workdir = "/work/a") {
  const { vscode } = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir,
    recentWorkdirs: [workdir],
  });
  bootstrapDesktopAuth();
  sendCommand("updateWorkdir", { workdir });
  return { vscode };
}

beforeEach(() => {
  resetWebviewStores();
});

afterEach(() => {
  document.head
    .querySelectorAll('script[src="./terminal.js"]')
    .forEach((s) => s.remove());
});

describe("session header git branch", () => {
  it("bound session omits the git badge from chat-header", () => {
    renderDesktop("/work/a");
    act(() => {
      sendCommand("updateCurrentSession", {
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a",
          firstMessage: "hello",
          lastActiveAt: new Date().toISOString(),
          worktreeName: "login-form",
          worktreeBranch: "worktree-login-form",
        },
      });
    });
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: {
          branches: ["main", "worktree-login-form"],
          current: "worktree-login-form",
        },
      });
    });

    const header = screen.getByTestId("chat-header");
    expect(
      within(header).queryByTestId("desktop-git-context"),
    ).not.toBeInTheDocument();
  });

  it("draft keeps branch controls in the input area and omits header badge", () => {
    renderDesktop("/work/a");
    // No bound session → draft / new-session UI (NewSessionPage has no chat-header)
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: { branches: ["main", "dev"], current: "main" },
      });
    });

    expect(screen.getByTestId("desktop-worktree-controls")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-git-context")).not.toBeInTheDocument();
  });

  it("keeps worktree opt-in across silent branch poll updates", () => {
    renderDesktop("/work/a");
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: { branches: ["main", "dev"], current: "main" },
      });
    });

    fireEvent.click(
      screen.getByTestId("desktop-worktree-checkbox").querySelector("input")!,
    );
    fireEvent.click(screen.getByTestId("desktop-branch-selector"));
    fireEvent.click(screen.getAllByTestId("desktop-branch-item")[1]!);
    expect(
      screen.getByTestId("desktop-worktree-checkbox").querySelector("input"),
    ).toBeChecked();
    expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
      "dev",
    );

    // Silent poll / visibility refresh: same workdir, fresh result object
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: { branches: ["main", "dev"], current: "main" },
      });
    });

    expect(
      screen.getByTestId("desktop-worktree-checkbox").querySelector("input"),
    ).toBeChecked();
    expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
      "dev",
    );
  });

  it("creates a worktree from the selected base branch, not HEAD/current", async () => {
    const { vscode } = renderDesktop("/work/a");
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: { branches: ["main", "dev"], current: "main" },
      });
    });

    fireEvent.click(
      screen.getByTestId("desktop-worktree-checkbox").querySelector("input")!,
    );
    fireEvent.click(screen.getByTestId("desktop-branch-selector"));
    fireEvent.click(screen.getAllByTestId("desktop-branch-item")[1]!);
    expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
      "dev",
    );

    vscode.postMessage.mockClear();
    const input = screen.getByTestId("message-input");
    input.textContent = "在新 worktree 里改登录";
    await fireInput(input, { inputType: "insertText" });
    fireEvent.click(screen.getByTestId("send-btn"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopCreateWorktree",
        workdir: "/work/a",
        baseBranch: "dev",
      }),
    );
  });

  it("posts desktopListGitBranches on the poll interval without clearing first", () => {
    vi.useFakeTimers();
    try {
      const { vscode } = renderDesktop("/work/a");
      act(() => {
        sendCommand("updateCurrentSession", {
          session: {
            id: "s1",
            sessionType: "main",
            workdir: "/work/a",
            firstMessage: "hello",
            lastActiveAt: new Date().toISOString(),
          },
        });
      });
      act(() => {
        sendCommand("desktopGitBranches", {
          workdir: "/work/a",
          result: { branches: ["main"], current: "main" },
        });
      });
      vscode.postMessage.mockClear();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListGitBranches",
          workdir: "/work/a",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
