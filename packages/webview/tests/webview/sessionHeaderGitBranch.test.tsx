/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { resetWebviewStores } from "../../src/stores";
import { createMockVscode, sendCommand, sendHostMessage } from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktop(workdir = "/work/a") {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir,
    recentWorkdirs: [workdir],
  });
  sendCommand("updateWorkdir", { workdir });
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode };
}

beforeEach(() => {
  resetWebviewStores();
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
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
});
