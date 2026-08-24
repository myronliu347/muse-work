/** @vitest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  DesktopSidebar,
  formatRelativeActiveAt,
  groupRecentSessionsByWorkdir,
  isTaskProjectWorkdir,
  partitionRecentSessions,
} from "../../src/components/desktop/DesktopSidebar";
import type { DesktopSessionEntry, DesktopTodoGroup } from "../../src/types";

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
      onTogglePopoRobot={noop}
      popoEnabled
      {...props}
    />,
  );
}

function todoGroup(
  overrides: Partial<DesktopTodoGroup> = {},
): DesktopTodoGroup {
  return {
    todoId: "todo-1",
    todoTitle: "设计评审",
    priority: "p1",
    sessions: [
      entry({ sessionId: "sess-plan", title: "设计评审" }),
      entry({ sessionId: "sess-exec", title: "写评审文档" }),
    ],
    ...overrides,
  };
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

  it("collapses 置顶 / 待办事项 / 任务 / 工作空间 top-level sections", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "p1", workdir: "/repo/alpha" })],
      todoGroups: [todoGroup()],
      recentSessions: [
        entry({ sessionId: "r1", workdir: "/repo/beta" }),
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
      ],
    });

    const pinToggle = screen.getByTestId("desktop-session-section-pin-toggle");
    const todosToggle = screen.getByTestId(
      "desktop-session-section-todos-toggle",
    );
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

    fireEvent.click(todosToggle);
    expect(todosToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(tasksToggle);
    expect(tasksToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(workspaceToggle);
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("renders todo groups inside 待办事项 with priority badge and session count", () => {
    renderSidebar({ todoGroups: [todoGroup()] });

    const group = screen.getByTestId("desktop-session-todo-group-todo-1");
    expect(group).toHaveTextContent("设计评审");
    expect(group).toHaveTextContent("P1");
    expect(group).toHaveTextContent("2");
    expect(
      screen.getByTestId("desktop-session-section-todos"),
    ).toContainElement(group);
    // 待办事项 section 不包含遗留任务会话（任务 section 是独立顶级分组）
    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).not.toContainElement(group);

    // 组内会话：规划 + 执行会话标题一眼可辨
    expect(
      screen.getByTestId("desktop-session-item-sess-plan"),
    ).toHaveTextContent("设计评审");
    expect(
      screen.getByTestId("desktop-session-item-sess-exec"),
    ).toHaveTextContent("写评审文档");
    // todo 会话只出现在待办事项分组，不重复进工作空间
    expect(
      screen.getByTestId("desktop-session-section-recent"),
    ).not.toContainElement(screen.getByTestId("desktop-session-item-sess-exec"));
  });

  it("collapses per todo group on row click", () => {
    renderSidebar({ todoGroups: [todoGroup()] });

    const row = screen.getByTestId("desktop-session-todo-row-todo-1");
    expect(
      row
        .closest(".desktop-session-workdir-group")
        ?.querySelector(".desktop-session-collapse"),
    ).toBeTruthy();
    fireEvent.click(row);
    expect(
      row
        .closest(".desktop-session-workdir-group")
        ?.querySelector(".desktop-session-collapse--closed"),
    ).toBeTruthy();
  });

  it("todo/任务 分组内会话保留置顶/删除按钮（与普通会话一致）", () => {
    renderSidebar({
      todoGroups: [todoGroup()],
      recentSessions: [
        entry({ sessionId: "r1", title: "普通会话" }),
        entry({
          sessionId: "t1",
          title: "遗留任务会话",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
      ],
    });

    // todo 分组内：规划/执行会话有置顶、有删除
    for (const sid of ["sess-plan", "sess-exec"]) {
      expect(screen.getByTestId(`desktop-session-pin-${sid}`)).toBeTruthy();
      expect(screen.getByTestId(`desktop-session-delete-${sid}`)).toBeTruthy();
    }
    // 遗留任务会话同样可置顶/删除
    expect(screen.getByTestId("desktop-session-pin-t1")).toBeTruthy();
    expect(screen.getByTestId("desktop-session-delete-t1")).toBeTruthy();
  });

  it("lists legacy auto task sessions in 任务, todo sessions in 待办事项", () => {
    renderSidebar({
      todoGroups: [
        todoGroup({
          todoId: "todo-1",
          sessions: [entry({ sessionId: "sess-exec", title: "写评审文档" })],
        }),
      ],
      recentSessions: [
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
      ],
    });

    expect(
      screen.getByTestId("desktop-session-section-todos"),
    ).toContainElement(screen.getByTestId("desktop-session-item-sess-exec"));
    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).toContainElement(screen.getByTestId("desktop-session-item-t1"));
    // todo 会话与遗留任务会话分属不同顶级分组
    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).not.toContainElement(screen.getByTestId("desktop-session-item-sess-exec"));
  });

  it("shows session counts on all top-level section headers", () => {
    renderSidebar({
      pinnedSessions: [entry({ sessionId: "p1", workdir: "/repo/alpha" })],
      todoGroups: [todoGroup()],
      recentSessions: [
        entry({
          sessionId: "t1",
          workdir: "/home/u/.muse-work/projects/20260813-aaaa",
        }),
        entry({ sessionId: "r1", workdir: "/repo/beta" }),
        entry({ sessionId: "r2", workdir: "/repo/beta" }),
      ],
    });

    expect(screen.getByTestId("desktop-session-section-pin")).toHaveTextContent(
      "置顶（1）",
    );
    expect(
      screen.getByTestId("desktop-session-section-todos"),
    ).toHaveTextContent("待办事项（2）");
    expect(
      screen.getByTestId("desktop-session-section-tasks"),
    ).toHaveTextContent("任务（1）");
    expect(
      screen.getByTestId("desktop-session-section-recent"),
    ).toHaveTextContent("工作空间（2）");
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
    expect(formatRelativeActiveAt(now - 5 * 60_000, now)).toBe("5min");
    expect(formatRelativeActiveAt(now - 23 * 60 * 60_000, now)).toBe("23h");
    expect(formatRelativeActiveAt(now - 10 * 24 * 60 * 60_000, now)).toBe(
      "10d",
    );
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
    fireEvent.mouseEnter(pinBtn.closest(".tooltip-container") as HTMLElement);
    expect(
      pinBtn.closest(".tooltip-container")?.querySelector(".tooltip-box"),
    ).toHaveTextContent("取消置顶");

    const deleteBtn = screen.getByTestId("desktop-session-delete-p1");
    fireEvent.mouseEnter(deleteBtn.closest(".tooltip-container") as HTMLElement);
    expect(
      deleteBtn.closest(".tooltip-container")?.querySelector(".tooltip-box"),
    ).toHaveTextContent("删除会话");

    const addBtn = screen.getByTestId("desktop-session-workdir-add-/repo/beta");
    fireEvent.mouseEnter(addBtn.closest(".tooltip-container") as HTMLElement);
    expect(
      addBtn.closest(".tooltip-container")?.querySelector(".tooltip-box"),
    ).toHaveTextContent("在此目录新建对话");
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
    expect(screen.getByTestId("desktop-new-session")).toBeEnabled();

    rerender(
      <DesktopSidebar
        onNewSession={noop}
        onNewSessionInPane={noop}
        onNewSessionInWorkdir={noop}
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
        onTogglePopoRobot={noop}
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

  it("groups worktree sessions under their main repo root", () => {
    const groups = groupRecentSessionsByWorkdir([
      entry({
        sessionId: "main",
        workdir: "/repo",
        lastActiveAt: 1,
      }),
      entry({
        sessionId: "wt-a",
        workdir: "/repo/.wave/worktrees/a",
        worktreeRepoRoot: "/repo",
        hasWorktree: true,
        worktreeName: "a",
        worktreeBranch: "worktree-a",
        lastActiveAt: 50,
      }),
      entry({
        sessionId: "wt-b",
        workdir: "/repo/.wave/worktrees/b",
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
          workdir: "/repo/.wave/worktrees/a",
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
          workdir: "/repo/.wave/worktrees/a",
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
    expect(card.textContent).toContain("/repo/.wave/worktrees/a");
    expect(card.textContent).toContain("Worktree");
  });

  it("keeps worktree rows as direct li children of the session ul", () => {
    const { container } = renderSidebar({
      recentSessions: [
        entry({
          sessionId: "wt1",
          workdir: "/repo/.wave/worktrees/a",
          hasWorktree: true,
          worktreeName: "a",
          worktreeBranch: "worktree-a",
          worktreeRepoRoot: "/repo",
        }),
        entry({ sessionId: "plain", workdir: "/repo" }),
      ],
    });
    // Worktree + plain rows share the /repo group, so the nested ul must
    // contain two <li> flex children. A tooltip wrapper span in between
    // would break the flex column and shift the row upward (regression:
    // hover card pressed the row into the group header above). The tooltip
    // box itself is `position: fixed` (out of flex flow) and may appear as
    // a sibling DIV — it must not be a wrapper around the <li>.
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

describe("DesktopSidebar popo entry", () => {
  it("renders the POPO 机器人 entry below 新对话", () => {
    renderSidebar();
    const newChat = screen.getByTestId("desktop-new-session");
    const popoBtn = screen.getByTestId("desktop-popo-robot");
    expect(
      newChat.compareDocumentPosition(popoBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("gives the POPO 机器人 entry an icon matching 新对话's", () => {
    renderSidebar();
    const newChat = screen.getByTestId("desktop-new-session");
    const popoBtn = screen.getByTestId("desktop-popo-robot");
    // 图标：共用 .app-menu-icon（同规格 14px SVG）
    expect(popoBtn.querySelector(".app-menu-icon")).not.toBeNull();
    expect(newChat.querySelector(".app-menu-icon")).not.toBeNull();
  });

  it("hides the POPO 机器人 entry when not configured", () => {
    renderSidebar({ popoEnabled: false });
    expect(screen.queryByTestId("desktop-popo-robot")).not.toBeInTheDocument();
  });

  it("highlights the POPO 机器人 menu item when active", () => {
    renderSidebar({ activeMenu: "popo-robot" });
    expect(screen.getByTestId("desktop-popo-robot").className).toContain("active");
    expect(screen.getByTestId("desktop-new-session").className).not.toContain("active");
  });

  it("highlights the 新对话 menu item when active", () => {
    renderSidebar({ activeMenu: "newChat" });
    expect(screen.getByTestId("desktop-new-session").className).toContain("active");
    expect(screen.getByTestId("desktop-popo-robot").className).not.toContain("active");
  });

  it("calls onTogglePopoRobot on click", async () => {
    const user = userEvent.setup();
    const onTogglePopoRobot = vi.fn();
    renderSidebar({ onTogglePopoRobot });
    await user.click(screen.getByTestId("desktop-popo-robot"));
    expect(onTogglePopoRobot).toHaveBeenCalledTimes(1);
  });
});
