/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DesktopSidebar } from "../../src/components/DesktopSidebar";
import type { DesktopSessionEntry } from "../../src/types";

afterEach(() => {
  cleanup();
});

const noop = () => {};

function entry(
  overrides: Partial<DesktopSessionEntry> & { sessionId: string },
): DesktopSessionEntry {
  return {
    title: overrides.title ?? overrides.sessionId,
    lastActiveAt: overrides.lastActiveAt ?? Date.now(),
    hasWorktree: overrides.hasWorktree ?? false,
    workdir: overrides.workdir ?? "/work/demo",
    ...overrides,
  };
}

function renderSidebar(
  props: Partial<React.ComponentProps<typeof DesktopSidebar>> = {},
) {
  return render(
    <DesktopSidebar
      onNewSession={noop}
      onNewSessionInPane={noop}
      isStreaming={false}
      disabled={false}
      onOpenSettings={noop}
      onLogin={noop}
      onLogout={noop}
      isAuthenticated={false}
      sessionTree={[]}
      pinnedSessions={[]}
      recentSessions={[]}
      onSelectSession={noop}
      onOpenPane={noop}
      onDeleteSession={noop}
      onTogglePin={noop}
      {...props}
    />,
  );
}

describe("DesktopSidebar pin/recent sessions", () => {
  it("shows spinner while running and unread dot when unreadDone", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "a", running: true })],
      recentSessions: [entry({ sessionId: "b", unreadDone: true })],
      currentSessionId: "a",
    });
    expect(
      screen
        .getByTestId("desktop-session-item-a")
        .querySelector(".codicon-loading"),
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("desktop-session-item-b")
        .querySelector(".desktop-session-unread-dot"),
    ).toBeTruthy();
  });

  it("renders fixed Pin and 最近 sections with workdir short name subtitle", () => {
    renderSidebar({
      pinnedSessions: [
        entry({
          sessionId: "p1",
          title: "Pinned chat",
          workdir: "/repo/alpha",
        }),
      ],
      recentSessions: [
        entry({
          sessionId: "r1",
          title: "Recent chat",
          workdir: "/repo/beta",
        }),
      ],
    });

    expect(screen.getByTestId("desktop-session-section-pin")).toHaveTextContent(
      "Pin",
    );
    expect(
      screen.getByTestId("desktop-session-section-recent"),
    ).toHaveTextContent("最近");
    expect(screen.getByTestId("desktop-session-item-p1")).toHaveTextContent(
      "alpha",
    );
    expect(screen.getByTestId("desktop-session-item-r1")).toHaveTextContent(
      "beta",
    );
  });

  it("does not show unread dot on the current session", () => {
    renderSidebar({
      recentSessions: [
        entry({ sessionId: "cur", unreadDone: true }),
        entry({ sessionId: "other", unreadDone: true }),
      ],
      currentSessionId: "cur",
    });

    expect(
      screen
        .getByTestId("desktop-session-item-cur")
        .querySelector(".desktop-session-unread-dot"),
    ).toBeNull();
    expect(
      screen
        .getByTestId("desktop-session-item-other")
        .querySelector(".desktop-session-unread-dot"),
    ).toBeTruthy();
  });

  it("does not render the old always-on decorative desktop-session-dot", () => {
    renderSidebar({
      recentSessions: [entry({ sessionId: "idle" })],
      currentSessionId: "idle",
    });
    expect(
      screen
        .getByTestId("desktop-session-item-idle")
        .querySelector(".desktop-session-dot"),
    ).toBeNull();
  });

  it("calls onTogglePin with inverted pinned on pin button click", () => {
    const onTogglePin = vi.fn();
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "p1", pinned: true })],
      recentSessions: [entry({ sessionId: "r1", pinned: false })],
      onTogglePin,
    });

    fireEvent.click(screen.getByTestId("desktop-session-pin-p1"));
    expect(onTogglePin).toHaveBeenCalledWith("p1", false);

    fireEvent.click(screen.getByTestId("desktop-session-pin-r1"));
    expect(onTogglePin).toHaveBeenCalledWith("r1", true);
  });

  it("disables new session only via disabled prop, not isStreaming", () => {
    const { rerender } = renderSidebar({
      isStreaming: true,
      disabled: false,
    });
    expect(screen.getByTestId("desktop-new-session")).toBeEnabled();

    rerender(
      <DesktopSidebar
        onNewSession={noop}
        onNewSessionInPane={noop}
        isStreaming={false}
        disabled={true}
        onOpenSettings={noop}
        onLogin={noop}
        onLogout={noop}
        isAuthenticated={false}
        sessionTree={[]}
        pinnedSessions={[]}
        recentSessions={[]}
        onSelectSession={noop}
        onOpenPane={noop}
        onDeleteSession={noop}
        onTogglePin={noop}
      />,
    );
    expect(screen.getByTestId("desktop-new-session")).toBeDisabled();
  });

  it("selects using the session workdir, not section key", () => {
    const onSelectSession = vi.fn();
    renderSidebar({
      recentSessions: [
        entry({ sessionId: "s1", workdir: "/real/path/proj" }),
      ],
      onSelectSession,
    });
    fireEvent.click(screen.getByTestId("desktop-session-item-s1"));
    expect(onSelectSession).toHaveBeenCalledWith("/real/path/proj", "s1");
  });
});
