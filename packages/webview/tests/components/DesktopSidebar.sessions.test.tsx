/** @vitest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import {
  DesktopSidebar,
  formatRelativeActiveAt,
  groupRecentSessionsByWorkdir,
  isTaskProjectWorkdir,
  partitionRecentSessions,
} from "../../src/components/desktop/DesktopSidebar";
import { DesktopSessionList } from "../../src/components/desktop/DesktopSessionList";
import type { DesktopIssueGroup, DesktopSessionEntry } from "../../src/types";

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

function issueGroup(
  overrides: Partial<DesktopIssueGroup> = {},
): DesktopIssueGroup {
  return {
    issueId: "issue-1",
    title: "设计评审",
    description: "评审登录方案",
    priority: "p1",
    status: "pending",
    items: [
      { id: "i1", content: "写方案", status: "done" },
      { id: "i2", content: "改登录", status: "pending" },
    ],
    sessions: [
      entry({ sessionId: "plan-1", title: "设计评审 · 规划" }),
      entry({ sessionId: "exec-1", title: "设计评审 · 执行" }),
    ],
    planningSessionId: "plan-1",
    executionSessionId: "exec-1",
    ...overrides,
  };
}

function railElement(
  props: Partial<React.ComponentProps<typeof DesktopSidebar>> = {},
) {
  return (
    <DesktopSidebar
      onNewSession={noop}
      onNewSessionInPane={noop}
      onNewSessionInWorkdir={noop}
      isStreaming={false}
      disabled={false}
      onOpenSettings={noop}
      sessionTree={[]}
      pinnedSessions={[]}
      recentSessions={[]}
      onSelectSession={noop}
      onOpenPane={noop}
      onDeleteSession={noop}
      onTogglePin={noop}
      {...props}
    />
  );
}

function sessionListElement(props: Record<string, unknown> = {}) {
  const {
    issueGroups: _issueGroups,
    closedIssueGroups: _closedIssueGroups,
    onSelectIssue: _onSelectIssue,
    onNewIssue: _onNewIssue,
    onOpenPlanning: _onOpenPlanning,
    onCompleteIssue: _onCompleteIssue,
    onCancelIssue: _onCancelIssue,
    onNewSessionInPane: _onNewSessionInPane,
    onOpenSettings: _onOpenSettings,
    onLogin: _onLogin,
    isAuthenticated: _isAuthenticated,
    activeMenu: _activeMenu,
    sidebarAccessHidden: _sidebarAccessHidden,
    ...rest
  } = props;
  return (
    <DesktopSessionList
      onNewSession={noop}
      onNewSessionInWorkdir={noop}
      isStreaming={false}
      disabled={false}
      sessionTree={[]}
      pinnedSessions={[]}
      recentSessions={[]}
      onSelectSession={noop}
      onOpenPane={noop}
      onDeleteSession={noop}
      onTogglePin={noop}
      {...rest}
    />
  );
}

function renderSidebar(props: Record<string, unknown> = {}) {
  return render(sessionListElement(props));
}

describe("DesktopSidebar pin/recent sessions", () => {
  it("marks Muse Bot unread until it is opened", () => {
    const { rerender } = render(railElement());
    expect(screen.queryByTestId("assistant-unread-dot")).toBeNull();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          command: "assistant:chat",
          line: { id: "1", role: "assistant", message: "好了" },
        },
      }),
    );
    expect(screen.getByTestId("assistant-unread-dot")).toBeTruthy();

    rerender(railElement({ activeMenu: "assistant" }));
    expect(screen.queryByTestId("assistant-unread-dot")).toBeNull();
  });

  it("shows spinner while running and unread dot when unreadDone", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "a", running: true })],
      recentSessions: [entry({ sessionId: "b", unreadDone: true })],
      currentSessionId: "a",
    });
    expect(
      screen
        .getByTestId("desktop-session-item-a")
        .querySelector("[data-testid='desktop-session-status-running']"),
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("desktop-session-item-b")
        .querySelector(".desktop-session-unread-dot"),
    ).toBeTruthy();
  });

  it("hides the 置顶 section when there are no pinned sessions", () => {
    renderSidebar({ pinnedSessions: [] });
    expect(screen.queryByTestId("desktop-session-section-pin")).toBeNull();
  });

  it("renders 置顶 flat and splits 工作空间 vs 任务 by workdir", () => {
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
        entry({
          sessionId: "r2",
          title: "Other in beta",
          workdir: "/repo/beta",
          lastActiveAt: Date.now() - 1000,
        }),
        entry({
          sessionId: "r3",
          title: "Gamma chat",
          workdir: "/repo/gamma",
          lastActiveAt: Date.now() - 5000,
        }),
        entry({
          sessionId: "t1",
          title: "hi",
          workdir: "/Users/demo/.muse-work/projects/20260813-28ba6a54",
          lastActiveAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        }),
      ],
    });

    expect(screen.getByTestId("desktop-session-section-pin")).toHaveTextContent(
      "置顶",
    );
    expect(
      screen.getByTestId("desktop-session-section-recent"),
    ).toHaveTextContent("工作空间");
    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).toHaveTextContent("任务");
    // Pin keeps workdir subtitle.
    expect(screen.getByTestId("desktop-session-item-p1")).toHaveTextContent(
      "alpha",
    );
    // Workspace: workdir is the group header; nested sessions omit subtitle.
    expect(
      screen.getByTestId("desktop-session-workdir-group-/repo/beta"),
    ).toHaveTextContent("beta");
    expect(
      screen.getByTestId("desktop-session-section-recent"),
    ).toContainElement(screen.getByTestId("desktop-session-item-r1"));
    expect(
      screen.getByTestId("desktop-session-section-recent"),
    ).not.toContainElement(screen.getByTestId("desktop-session-item-t1"));
    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).toContainElement(screen.getByTestId("desktop-session-item-t1"));
    expect(
      screen.queryByTestId(
        "desktop-session-workdir-group-/Users/demo/.muse-work/projects/20260813-28ba6a54",
      ),
    ).toBeNull();
    expect(screen.getByTestId("desktop-session-item-t1")).not.toHaveTextContent(
      "20260813-28ba6a54",
    );
    expect(screen.getByTestId("desktop-session-active-at-t1")).toHaveTextContent(
      "10d",
    );
    // 任务 appears before 工作空间 in the tree.
    const tree = screen.getByTestId("desktop-session-tree");
    const tasksIdx = tree.innerHTML.indexOf('data-testid="desktop-session-section-tasks"');
    const workspaceIdx = tree.innerHTML.indexOf(
      'data-testid="desktop-session-section-recent"',
    );
    expect(tasksIdx).toBeGreaterThan(-1);
    expect(workspaceIdx).toBeGreaterThan(-1);
    expect(tasksIdx).toBeLessThan(workspaceIdx);
  });

  it("collapses 置顶 / 任务 / 工作空间 top-level sections", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "p1", workdir: "/repo/alpha" })],
      recentSessions: [
        entry({ sessionId: "r1", workdir: "/repo/beta" }),
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
      ],
    });

    const pinToggle = screen.getByTestId("desktop-session-section-pin-toggle");
    const tasksToggle = screen.getByTestId(
      "desktop-session-section-tasks-toggle",
    );
    const workspaceToggle = screen.getByTestId(
      "desktop-session-section-recent-toggle",
    );

    expect(pinToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(pinToggle);
    expect(pinToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen
        .getByTestId("desktop-session-section-pin")
        .querySelector(".desktop-session-collapse--closed"),
    ).toBeTruthy();

    fireEvent.click(tasksToggle);
    expect(tasksToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(workspaceToggle);
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("lists auto task project sessions in 任务", () => {
    renderSidebar({
      recentSessions: [
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
      ],
    });

    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).toContainElement(screen.getByTestId("desktop-session-item-t1"));
  });

  it("does not show session counts on section headers", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "p1", workdir: "/repo/alpha" })],
      recentSessions: [
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
        entry({ sessionId: "r1", workdir: "/repo/beta" }),
      ],
      issueGroups: [issueGroup({ issueId: "a", title: "Issue A" })],
    });

    expect(
      document.querySelector(".desktop-session-count"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("desktop-session-section-pin")).toHaveTextContent(
      "置顶",
    );
  });

  it("shows workdir chevron over folder icon on hover", () => {
    renderSidebar({
      recentSessions: [entry({ sessionId: "r1", workdir: "/repo/beta" })],
    });
    const row = screen.getByTestId("desktop-session-workdir-row-/repo/beta");
    expect(row.querySelector(".codicon-folder-opened")).toBeTruthy();
    expect(row.querySelector(".desktop-session-workdir-chevron")).toBeTruthy();
    fireEvent.click(row);
    expect(row.querySelector(".codicon-folder")).toBeTruthy();
    expect(
      row.querySelector(".desktop-session-workdir-chevron--collapsed"),
    ).toBeTruthy();
  });

  it("clips closed section bodies so nested workdir lists do not add header gap", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "../../src/styles/DesktopApp.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.desktop-session-collapse--closed\s*\{[^}]*height:\s*0/s,
    );
    expect(css).toMatch(
      /\.desktop-session-tree\s*\{[^}]*gap:\s*var\(--space-2\)/s,
    );
    expect(css).toMatch(
      /\.desktop-session-tree\s*\{[^}]*padding:\s*calc\(var\(--space-1\)\s*\+\s*var\(--space-2\)\)/s,
    );
  });

  it("keeps space between workdir folder icon and name", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "../../src/styles/DesktopApp.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.desktop-session-workdir-icon-slot\s+\.codicon\s*\{[^}]*font-size:\s*14px\s*!important/s,
    );
    expect(css).toMatch(
      /\.desktop-session-workdir-row\s*\{[^}]*gap:\s*var\(--space-2\)/s,
    );
  });

  it("formatRelativeActiveAt covers minute/day buckets", () => {
    const now = Date.parse("2026-08-14T00:00:00.000Z");
    expect(formatRelativeActiveAt(now - 30_000, now)).toBe("now");
    expect(formatRelativeActiveAt(now - 5 * 60_000, now)).toBe("5m");
    expect(formatRelativeActiveAt(now - 23 * 60 * 60_000, now)).toBe("23h");
    expect(formatRelativeActiveAt(now - 10 * 24 * 60 * 60_000, now)).toBe(
      "10d",
    );
    expect(formatRelativeActiveAt(now - 40 * 24 * 60 * 60_000, now)).toBe("1mo");
    expect(formatRelativeActiveAt(now - 400 * 24 * 60 * 60_000, now)).toBe("1y");
  });

  it("isTaskProjectWorkdir detects .muse-work/projects paths", () => {
    expect(
      isTaskProjectWorkdir("/Users/a/.muse-work/projects/20260813-28ba6a54"),
    ).toBe(true);
    expect(
      isTaskProjectWorkdir("/Users/a/.dev-muse-work/projects/20260813-28ba6a54"),
    ).toBe(true);
    expect(isTaskProjectWorkdir("/repo/beta")).toBe(false);
    expect(
      partitionRecentSessions([
        entry({ sessionId: "a", workdir: "/repo/beta" }),
        entry({
          sessionId: "b",
          workdir: "C:\\Users\\a\\.muse-work\\projects\\x",
        }),
      ]),
    ).toEqual({
      workspace: [expect.objectContaining({ sessionId: "a" })],
      tasks: [expect.objectContaining({ sessionId: "b" })],
    });
  });

  it("shows tooltips on pin, delete, and workdir-add icon buttons", () => {
    renderSidebar({
      pinnedSessions: [
        entry({ sessionId: "p1", pinned: true, workdir: "/repo/alpha" }),
      ],
      recentSessions: [
        entry({ sessionId: "r1", workdir: "/repo/beta" }),
      ],
    });

    const pinBtn = screen.getByTestId("desktop-session-pin-p1");
    const pinWrap = pinBtn.closest(".tooltip-container") as HTMLElement;
    fireEvent.mouseEnter(pinWrap);
    expect(document.querySelector(".tooltip-box.visible")).toHaveTextContent(
      "取消置顶",
    );
    fireEvent.mouseLeave(pinWrap);

    const deleteBtn = screen.getByTestId("desktop-session-delete-p1");
    const deleteWrap = deleteBtn.closest(".tooltip-container") as HTMLElement;
    fireEvent.mouseEnter(deleteWrap);
    expect(document.querySelector(".tooltip-box.visible")).toHaveTextContent(
      "删除会话",
    );
    fireEvent.mouseLeave(deleteWrap);

    const addBtn = screen.getByTestId("desktop-session-workdir-add-/repo/beta");
    fireEvent.mouseEnter(addBtn.closest(".tooltip-container") as HTMLElement);
    expect(document.querySelector(".tooltip-box.visible")).toHaveTextContent(
      "在此目录新建对话",
    );
  });

  it("calls onNewSessionInWorkdir from workdir group + button", () => {
    const onNewSessionInWorkdir = vi.fn();
    renderSidebar({
      recentSessions: [
        entry({ sessionId: "r1", workdir: "/repo/beta" }),
      ],
      onNewSessionInWorkdir,
    });
    fireEvent.click(
      screen.getByTestId("desktop-session-workdir-add-/repo/beta"),
    );
    expect(onNewSessionInWorkdir).toHaveBeenCalledWith("/repo/beta");
  });

  it("opens workdir in editor from the group context menu", () => {
    const onOpenInEditor = vi.fn();
    renderSidebar({
      recentSessions: [entry({ sessionId: "r1", workdir: "/repo/beta" })],
      onOpenInEditor,
    });

    fireEvent.contextMenu(
      screen.getByTestId("desktop-session-workdir-row-/repo/beta"),
    );
    fireEvent.click(screen.getByTestId("desktop-workdir-open-in-editor"));
    expect(onOpenInEditor).toHaveBeenCalledWith("/repo/beta");
  });

  it("opens workdir in terminal from the group context menu", () => {
    const onOpenInTerminal = vi.fn();
    renderSidebar({
      recentSessions: [entry({ sessionId: "r1", workdir: "/repo/beta" })],
      onOpenInTerminal,
    });

    fireEvent.contextMenu(
      screen.getByTestId("desktop-session-workdir-row-/repo/beta"),
    );
    fireEvent.click(screen.getByTestId("desktop-workdir-open-in-terminal"));
    expect(onOpenInTerminal).toHaveBeenCalledWith("/repo/beta");
  });

  it("reveals workdir in Finder from the group context menu", () => {
    const onRevealInFinder = vi.fn();
    renderSidebar({
      recentSessions: [entry({ sessionId: "r1", workdir: "/repo/beta" })],
      onRevealInFinder,
    });

    fireEvent.contextMenu(
      screen.getByTestId("desktop-session-workdir-row-/repo/beta"),
    );
    fireEvent.click(
      screen.getByTestId("desktop-workdir-reveal-in-finder"),
    );
    expect(onRevealInFinder).toHaveBeenCalledWith("/repo/beta");
  });

  it("double-click title renames via onRenameSession", () => {
    const onRenameSession = vi.fn();
    renderSidebar({
      recentSessions: [
        entry({
          sessionId: "r1",
          title: "Old title",
          workdir: "/repo/beta",
        }),
      ],
      onRenameSession,
    });
    fireEvent.doubleClick(
      screen.getByTestId("desktop-session-item-r1").querySelector(
        ".desktop-session-title",
      )!,
    );
    const input = screen.getByTestId("desktop-session-title-input-r1");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameSession).toHaveBeenCalledWith("r1", "New title");
  });

  it("groupRecentSessionsByWorkdir sorts by latest activity", () => {
    const groups = groupRecentSessionsByWorkdir([
      entry({
        sessionId: "old",
        workdir: "/a",
        lastActiveAt: 1,
      }),
      entry({
        sessionId: "new",
        workdir: "/b",
        lastActiveAt: 99,
      }),
      entry({
        sessionId: "mid",
        workdir: "/a",
        lastActiveAt: 50,
      }),
    ]);
    expect(groups.map((g) => g.workdir)).toEqual(["/b", "/a"]);
    expect(groups[1]?.sessions.map((s) => s.sessionId)).toEqual(["mid", "old"]);
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
    const newSession = () =>
      within(screen.getByTestId("desktop-session-list")).getByTestId(
        "desktop-new-session",
      );
    expect(newSession()).toBeEnabled();

    rerender(
      sessionListElement({
        isStreaming: false,
        disabled: true,
      }),
    );
    expect(newSession()).toBeDisabled();
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

  it("groups worktree sessions under their main repo root", () => {
    const groups = groupRecentSessionsByWorkdir([
      entry({
        sessionId: "main",
        workdir: "/repo",
        lastActiveAt: 1,
      }),
      entry({
        sessionId: "wt-a",
        workdir: "/Users/me/.muse-work/worktrees/a",
        worktreeRepoRoot: "/repo",
        hasWorktree: true,
        worktreeName: "a",
        worktreeBranch: "worktree-a",
        lastActiveAt: 50,
      }),
      entry({
        sessionId: "wt-b",
        workdir: "/Users/me/.muse-work/worktrees/b",
        worktreeRepoRoot: "/repo",
        hasWorktree: true,
        worktreeName: "b",
        worktreeBranch: "worktree-b",
        lastActiveAt: 99,
      }),
      entry({
        sessionId: "other",
        workdir: "/elsewhere",
        lastActiveAt: 10,
      }),
    ]);
    expect(groups.map((g) => g.workdir)).toEqual(["/repo", "/elsewhere"]);
    const repoGroup = groups[0]!;
    expect(repoGroup.label).toBe("repo");
    expect(repoGroup.sessions.map((s) => s.sessionId)).toEqual([
      "wt-b",
      "wt-a",
      "main",
    ]);
  });

  it("renders a branch badge on worktree session rows only", () => {
    renderSidebar({
      recentSessions: [
        entry({
          sessionId: "wt1",
          workdir: "/Users/me/.muse-work/worktrees/a",
          hasWorktree: true,
          worktreeName: "a",
          worktreeBranch: "worktree-a",
        }),
        entry({ sessionId: "plain", workdir: "/repo" }),
      ],
    });
    expect(
      screen.getByTestId("desktop-session-item-wt1").querySelector(
        ".desktop-session-worktree-badge .codicon-worktree",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId("desktop-session-item-plain").querySelector(
        ".desktop-session-worktree-badge",
      ),
    ).toBeNull();
  });

  it("shows a worktree metadata card on hover of a worktree row", () => {
    renderSidebar({
      recentSessions: [
        entry({
          sessionId: "wt1",
          title: "WT session",
          workdir: "/Users/me/.muse-work/worktrees/a",
          hasWorktree: true,
          worktreeName: "a",
          worktreeBranch: "worktree-a",
        }),
      ],
    });
    const item = screen.getByTestId("desktop-session-item-wt1");
    fireEvent.mouseEnter(item);
    const card = screen.getByTestId("desktop-worktree-card");
    expect(card.textContent).toContain("WT session");
    expect(card.textContent).toContain("worktree-a");
    expect(card.textContent).toContain("a");
    expect(card.textContent).toContain("/Users/me/.muse-work/worktrees/a");
    expect(card.textContent).toContain("Worktree");
  });


  it("keeps issue groups out of the session list", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "p1", workdir: "/repo/alpha" })],
      issueGroups: [issueGroup({ priority: "p0", title: "设计评审" })],
      recentSessions: [
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
      ],
    });

    const list = screen.getByTestId("desktop-session-list");
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(screen.queryByText("设计评审")).toBeNull();
    expect(within(list).getByTestId("desktop-session-item-p1")).toBeTruthy();
    expect(within(list).getByTestId("desktop-session-section-tasks")).toBeTruthy();
    expect(within(list).getByTestId("desktop-new-session")).toBeTruthy();
  });

  it("does not list planning or execution sessions from issue groups", () => {
    renderSidebar({ issueGroups: [issueGroup({ agentMode: "split" })] });
    expect(screen.queryByTestId("desktop-session-item-plan-1")).toBeNull();
    expect(screen.queryByTestId("desktop-session-item-exec-1")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
  });

  it("keeps the issue title on one line and overlays status/more on hover", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "../../src/styles/DesktopApp.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.issue-sidebar-title\s*\{[^}]*white-space:\s*nowrap/s,
    );
    expect(css).toMatch(
      /\.issue-sidebar-title\s*\{[^}]*text-overflow:\s*ellipsis/s,
    );
    expect(css).not.toMatch(
      /\.issue-sidebar-title\s*\{[^}]*-webkit-line-clamp:\s*2/s,
    );
    expect(css).toMatch(
      /\.issue-sidebar-meta\s*\{[^}]*position:\s*absolute/s,
    );
    expect(css).toMatch(
      /\.issue-sidebar-status\s*\{[^}]*display:\s*none/s,
    );
    expect(css).toMatch(
      /\.issue-sidebar-row:hover \.issue-sidebar-priority/s,
    );
  });

  it("keeps worktree rows as direct li children of the session ul", () => {
    const { container } = renderSidebar({
      recentSessions: [
        entry({
          sessionId: "wt1",
          workdir: "/Users/me/.muse-work/worktrees/a",
          hasWorktree: true,
          worktreeName: "a",
          worktreeBranch: "worktree-a",
          worktreeRepoRoot: "/repo",
        }),
        entry({ sessionId: "plain", workdir: "/repo" }),
      ],
    });
    const list = container.querySelector(".desktop-session-items");
    expect(list).toBeTruthy();
    const lis = Array.from(list!.querySelectorAll(":scope > li"));
    expect(lis.map((el) => el.getAttribute("data-testid"))).toEqual([
      "desktop-session-item-wt1",
      "desktop-session-item-plain",
    ]);
    expect(
      Array.from(list!.querySelectorAll(":scope > li")).every(
        (el) => el.tagName === "LI",
      ),
    ).toBe(true);
  });
});

it("renders 新对话 inside the session list", () => {
  renderSidebar();
  expect(
    within(screen.getByTestId("desktop-session-list")).getByTestId(
      "desktop-new-session",
    ),
  ).toBeTruthy();
});
