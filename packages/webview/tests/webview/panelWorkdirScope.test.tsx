/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { resetWebviewStores } from "../../src/stores";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktop(options?: { workdir?: string }) {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: options?.workdir,
    recentWorkdirs: options?.workdir ? [options.workdir] : [],
  });
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const panelStatePosts = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .filter(([msg]) => msg.command === "desktopPanelState")
    .map(([msg]) => msg.checked as string[]);

const lastPanelState = (vscode: ReturnType<typeof createMockVscode>) => {
  const posts = panelStatePosts(vscode);
  return posts[posts.length - 1];
};

beforeEach(() => {
  resetWebviewStores();
});

afterEach(() => {
  delete window.waveHostType;
  document.head
    .querySelectorAll('script[src="./terminal.js"]')
    .forEach((s) => s.remove());
});

describe("workdir-level panel groups", () => {
  const session = (id: string, workdir = "/work/a") => ({
    id,
    sessionType: "main",
    workdir,
    firstMessage: id,
    lastActiveAt: new Date().toISOString(),
  });

  const setWorkdir = (workdir: string) => {
    sendCommand("desktopWorkdirState", {
      workdir,
      recentWorkdirs: [workdir],
    });
    sendCommand("updateWorkdir", { workdir });
  };

  const openPanel = (kind: string) => {
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId(`panel-toggle-item-${kind}`));
    fireEvent.mouseDown(document.body);
  };

  const pushTree = (entries: { sessionId: string; workdir: string }[]) =>
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "recent",
          sessions: entries.map((e) => ({
            sessionId: e.sessionId,
            title: e.sessionId,
            lastActiveAt: Date.now(),
            hasWorktree: false,
            workdir: e.workdir,
          })),
        },
      ],
    });

  it("same workdir session switch keeps the panel group", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    setWorkdir("/work/a");
    act(() => {
      sendCommand("updateCurrentSession", { session: session("s1") });
    });
    openPanel("diff");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    act(() => {
      sendCommand("updateCurrentSession", { session: session("s2") });
    });
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);
  });

  it("switching workdir swaps the panel group; switching back restores", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    setWorkdir("/work/a");
    act(() => {
      sendCommand("updateCurrentSession", {
        session: session("s1", "/work/a"),
      });
    });
    openPanel("diff");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    setWorkdir("/work/b");
    act(() => {
      sendCommand("updateCurrentSession", {
        session: session("s2", "/work/b"),
      });
    });
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual([]);

    openPanel("terminal");
    expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();

    setWorkdir("/work/a");
    act(() => {
      sendCommand("updateCurrentSession", {
        session: session("s1", "/work/a"),
      });
    });
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-pane")).not.toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);
  });

  it("prunes panel group when workdir leaves the session tree", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    setWorkdir("/work/a");
    pushTree([
      { sessionId: "s1", workdir: "/work/a" },
      { sessionId: "s2", workdir: "/work/b" },
    ]);
    act(() => {
      sendCommand("updateCurrentSession", { session: session("s1") });
    });
    openPanel("diff");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    setWorkdir("/work/b");
    act(() => {
      sendCommand("updateCurrentSession", {
        session: session("s2", "/work/b"),
      });
    });
    pushTree([{ sessionId: "s2", workdir: "/work/b" }]);

    setWorkdir("/work/a");
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
  });
});
