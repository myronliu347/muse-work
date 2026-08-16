/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { resetWebviewStores } from "../../src/stores";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
  renderDesktopApp,
  bootstrapDesktopAuth,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

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
  it("bound session shows git badge in chat-header, not in the input toolbar", () => {
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
      within(header).getByTestId("desktop-git-context"),
    ).toBeInTheDocument();
    expect(within(header).getByTestId("desktop-git-branch")).toHaveTextContent(
      "worktree-login-form",
    );
    expect(
      within(header).getByTestId("desktop-git-worktree"),
    ).toHaveTextContent("login-form");

    expect(
      document.querySelector(
        '.input-toolbar-left [data-testid="desktop-git-context"]',
      ),
    ).toBeNull();
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

  it("updates header branch when a later desktopGitBranches current changes", () => {
    vi.useFakeTimers();
    try {
      renderDesktop("/work/a");
      act(() => {
        sendCommand("updateCurrentSession", {
          session: {
            id: "s1",
            sessionType: "main",
            workdir: "/work/a",
            firstMessage: "hello",
            lastActiveAt: new Date().toISOString(),
            worktreeBranch: "old-branch",
          },
        });
      });
      act(() => {
        sendCommand("desktopGitBranches", {
          workdir: "/work/a",
          result: {
            branches: ["old-branch", "new-branch"],
            current: "old-branch",
          },
        });
      });
      expect(
        within(screen.getByTestId("chat-header")).getByTestId(
          "desktop-git-branch",
        ),
      ).toHaveTextContent("old-branch");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      act(() => {
        sendCommand("desktopGitBranches", {
          workdir: "/work/a",
          result: {
            branches: ["old-branch", "new-branch"],
            current: "new-branch",
          },
        });
      });
      expect(
        within(screen.getByTestId("chat-header")).getByTestId(
          "desktop-git-branch",
        ),
      ).toHaveTextContent("new-branch");
    } finally {
      vi.useRealTimers();
    }
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
      expect(
        within(screen.getByTestId("chat-header")).getByTestId(
          "desktop-git-branch",
        ),
      ).toHaveTextContent("main");
    } finally {
      vi.useRealTimers();
    }
  });
});
