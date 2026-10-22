/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { DesktopShell } from "../../src/components/desktop/DesktopShell";
import { MuseApiClient } from "../../src/muse/apiClient";
import { resetWebviewStores } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import type {
  DesktopHostProps,
  DesktopSessionEntry,
  VsCodeApi,
} from "../../src/types";
import { establishSession } from "../webview/test-utils";

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

function hostWithPanes(): DesktopHostProps {
  return {
    type: "desktop",
    host: "local",
    workdir: "/tmp/proj",
    recentWorkdirs: ["/tmp/proj"],
    onSelectWorkdir: vi.fn(),
    onSelectRecentWorkdir: vi.fn(),
    onRemoveRecentWorkdir: vi.fn(),
    sessionTree: [
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
    ],
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onTogglePin: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenPane: vi.fn(),
    panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
    focusedPaneId: "pane-1",
  };
}

describe("desktop icon rail", () => {
  it("opens on Muse Bot and switches views from the rail", async () => {
    const user = userEvent.setup();
    render(
      <DesktopShell
        vscode={mockVscode()}
        host={hostWithPanes()}
        onOpenSettings={vi.fn()}
        api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
        postToHost={vi.fn()}
      />,
    );

    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(screen.queryByTestId("desktop-brand")).toBeNull();

    const sessions = screen.getByTestId("desktop-sessions-menu");
    const automations = screen.getByTestId("desktop-automations-menu");
    const settings = screen.getByTestId("desktop-settings-btn");
    expect(sessions).toHaveAttribute("aria-label", "会话");
    expect(sessions).toHaveAttribute("title", "会话");
    expect(automations).toHaveAttribute("aria-label", "自动化");
    expect(automations).toHaveAttribute("title", "自动化");
    expect(settings).toHaveAttribute("aria-label", "设置");
    expect(settings).toHaveAttribute("title", "设置");

    await user.click(sessions);
    expect(screen.getByTestId("desktop-assistant-menu").className).not.toContain(
      "active",
    );
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();

    await user.click(screen.getByTestId("desktop-assistant-menu"));
    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
  });

  it("opens the no-pane desktop on Muse Bot and switches to sessions", async () => {
    resetWebviewStores();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={mockVscode()}
          host={{ ...hostWithPanes(), panes: [], focusedPaneId: null }}
        />
      </MuseTheme>,
    );
    establishSession();

    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();

    await user.click(screen.getByTestId("desktop-sessions-menu"));

    expect(screen.getByTestId("desktop-assistant-menu").className).not.toContain(
      "active",
    );
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
  });
});
