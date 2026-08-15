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
    // Prefer the dock toggle for the default 变更 open; other kinds use
    // the same keyboard shortcuts the app still binds (single-panel toggle).
    if (kind === "diff" && !screen.queryByTestId("desktop-panel-dock")) {
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      return;
    }
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    if (kind === "terminal") {
      fireEvent.keyDown(window, {
        key: "`",
        code: "Backquote",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        bubbles: true,
      });
      return;
    }
    const key =
      kind === "preview" ? "p" : kind === "diff" ? "d" : kind === "file" ? "f" : null;
    if (!key) throw new Error(`unknown panel kind: ${kind}`);
    fireEvent.keyDown(window, {
      key,
      ctrlKey: !isMac,
      metaKey: isMac,
      shiftKey: true,
      bubbles: true,
    });
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
