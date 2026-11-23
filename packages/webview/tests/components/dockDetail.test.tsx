/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import {
  DOCK_DETAIL_RAIL_MAX_WIDTH,
  DOCK_DETAIL_RAIL_MIN_CONTENT,
  DOCK_DETAIL_RAIL_MIN_WIDTH,
  DOCK_DETAIL_RAIL_WIDTH,
  DockDetail,
  clampDockDetailRailWidth,
  dockDetailRailFits,
} from "../../src/components/desktop/DockDetail";
import {
  initialBotWorkspace,
  selectPanel as applySelectPanel,
} from "../../src/components/desktop/botWorkspace";
import { DesktopPanelDock } from "../../src/components/desktop/DesktopPanelDock";
import {
  BotWorkspaceProvider,
  useBotWorkspaceController,
} from "../../src/components/desktop/BotTabs";
import { DOCK_DETAIL_TAB, PANEL_ADD_ORDER } from "../../src/muse/panelTabs";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  emptyFileTreeState,
  resetWebviewStores,
  usePanelGroupStore,
} from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import type { DesktopIssueGroup, DesktopPanelKind } from "../../src/types";
import {
  createMockDesktopHost,
  createMockVscode,
  establishSession,
  fixtures,
  sendHostMessage,
} from "../webview/test-utils";

async function ensureAssistantDock(
  scope: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
) {
  const existing = within(scope).queryByTestId("desktop-panel-dock");
  if (existing) return existing;
  await user.click(within(scope).getByTestId("panel-toggle-btn"));
  return within(scope).findByTestId("desktop-panel-dock");
}

const RADII = "圆角还没对齐";
const A11Y = "无障碍检查";
const QUEUE_TITLE = "回复 Ty";
const QUEUE_BODY = "需要今天回复";

const KINDS: DesktopPanelKind[] = ["preview", "diff", "terminal", "file"];

function issue(
  partial: Pick<DesktopIssueGroup, "issueId" | "title" | "priority"> &
    Partial<
      Pick<
        DesktopIssueGroup,
        "items" | "status" | "closeNote" | "description" | "updatedAt"
      >
    >,
): DesktopIssueGroup {
  return {
    status: "planning",
    agentMode: "single",
    items: [],
    sessions: [
      {
        sessionId: `plan-${partial.issueId}`,
        title: partial.title,
        lastActiveAt: 1,
        workdir: `/work/${partial.issueId}`,
        hasWorktree: false,
      },
    ],
    ...partial,
  };
}

const RADII_ITEMS = [
  { id: "measure", content: "量一下圆角", status: "pending" },
  { id: "token", content: "改 token", status: "done" },
];

const A11Y_ITEMS = [{ id: "focus", content: "补上焦点环", status: "pending" }];

function stubClientWidth(width: number): () => void {
  const proto = HTMLElement.prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get() {
      return width;
    },
  });
  return () => {
    if (previous) Object.defineProperty(proto, "clientWidth", previous);
    else delete (proto as { clientWidth?: number }).clientWidth;
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubAssistant(fetched: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url.includes("/assistant/messages")) {
        return jsonResponse({ messages: [], hasMore: false });
      }
      if (url.includes("/assistant/queue")) {
        return jsonResponse({
          items: [{ type: "chat", title: QUEUE_TITLE }],
        });
      }
      if (url.includes("/assistant/session")) {
        return jsonResponse({
          sessionId: "assistant",
          title: "小盏",
          workdir: "/tmp/proj",
          working: false,
        });
      }
      if (url.includes("/automations")) return jsonResponse({ automations: [] });
      if (url.includes("/scenarios/models")) return jsonResponse({ models: {} });
      if (url.includes("/providers/openai-compatible")) {
        return jsonResponse({
          baseURL: "https://api.example.test/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          hasApiKey: false,
          hasStoredApiKey: false,
          models: [{ id: "m", label: "M" }],
        });
      }
      if (url.endsWith("/providers") || url.includes("/providers?")) {
        return jsonResponse({
          providers: [
            {
              id: "openai-compatible",
              displayName: "OpenAI",
              models: [{ id: "m", label: "M" }],
            },
          ],
          active: { providerId: "openai-compatible", modelId: "m" },
        });
      }
      return jsonResponse({});
    }),
  );
}

function stubWideViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1600,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  }));
}

function TwoSessionPanes({
  focusedPaneId,
  vscode,
}: {
  focusedPaneId: string;
  vscode: ReturnType<typeof createMockVscode>;
}) {
  const workspace = useBotWorkspaceController(null);
  const host = createMockDesktopHost({
    panes: [
      { paneId: "pane-a", sessionId: "sess-a" },
      { paneId: "pane-b", sessionId: "sess-b" },
    ],
    focusedPaneId,
  });
  return (
    <BotWorkspaceProvider value={workspace}>
      <div data-testid="desktop-pane-pane-a">
        <ChatApp vscode={vscode} host={host} paneId="pane-a" />
      </div>
      <div data-testid="desktop-pane-pane-b">
        <ChatApp vscode={vscode} host={host} paneId="pane-b" />
      </div>
    </BotWorkspaceProvider>
  );
}

function tabLabels(): string[] {
  return [...document.querySelectorAll(".desktop-panel-dock-tabs > .desktop-panel-tab")].map(
    (el) => (el.textContent ?? "").replace(/\s+/g, ""),
  );
}

const dockProps = {
  onSelect: () => {},
  onCloseTab: () => {},
  onAddPanel: () => {},
  panelToggle: { onToggleDock: () => {} },
  fullscreen: false,
  onToggleFullscreen: () => {},
  width: 420,
  onWidthChange: () => {},
  maxWidth: 800,
};

describe("dock detail tab", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWebviewStores();
  });

  it("puts 详情 first and keeps the original kind tabs out of the add menu", () => {
    expect(DOCK_DETAIL_TAB).toBe("detail");
    expect(PANEL_ADD_ORDER).toEqual(["file", "terminal", "preview", "diff"]);
    expect(PANEL_ADD_ORDER).not.toContain(DOCK_DETAIL_TAB);
    expect(KINDS).toEqual(["preview", "diff", "terminal", "file"]);

    const onSelect = vi.fn();
    const onSelectDetail = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...dockProps}
          checked={["file", "terminal", "preview", "diff"]}
          active="file"
          onSelect={onSelect}
          onSelectDetail={onSelectDetail}
        >
          <div data-testid="file-tree">tree</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    expect(tabLabels()).toEqual(["详情", "文件", "终端", "浏览器", "变更"]);
    expect(screen.queryByTestId("desktop-panel-tab-close-detail")).toBeNull();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();

    onSelect.mockClear();
    screen.getByRole("button", { name: "详情" }).click();
    expect(onSelectDetail).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the selected title on the detail tab and the full title in the tooltip", async () => {
    const title = "分析 wave-agent 项目结构";
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...dockProps}
          checked={[]}
          active="file"
          detailTitle={title}
          onSelectDetail={() => {}}
        >
          <div />
        </DesktopPanelDock>
      </MuseTheme>,
    );

    const tab = screen.getByRole("button", { name: title });
    expect(tab.querySelector(".desktop-panel-tab-text")).toHaveTextContent(title);
    await userEvent.hover(tab);
    expect(document.querySelector(".tooltip-box.visible")).toHaveTextContent(title);
  });

  it("shows the running mark on the detail tab while the issue is working", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...dockProps}
          checked={[]}
          active="file"
          detailTitle="【BugFix】高码"
          detailPresence="running"
          onSelectDetail={() => {}}
        >
          <div />
        </DesktopPanelDock>
      </MuseTheme>,
    );
    const tab = screen.getByTestId("desktop-panel-tab-detail");
    expect(tab.querySelector("[data-testid='desktop-session-status-running']")).toBeTruthy();
    expect(tab.querySelector(".codicon-note")).toBeNull();
  });

  it("replaces the dock body with detail and hides the file tree", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...dockProps}
          checked={["file"]}
          active="file"
          detailActive
          onSelectDetail={() => {}}
          detail={<div>详情正文</div>}
        >
          <div data-testid="file-tree">tree</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    expect(screen.getByText("详情正文")).toBeVisible();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(screen.getByTestId("file-tree")).not.toBeVisible();
    expect(screen.getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(screen.getByTestId("desktop-panel-tab-file")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });

  it("shows an issue title, status, checklist, and only the session action label", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    const radii = issue({
      issueId: "radii",
      title: RADII,
      priority: "p1",
      items: RADII_ITEMS,
    });
    const { rerender } = render(
      <DockDetail
        selection={{ kind: "issue", issue: radii }}
        actionLabel="打开会话"
        onOpenSession={onOpenSession}
      />,
    );

    expect(screen.getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(screen.getByText("空闲")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("量一下圆角")).toBeInTheDocument();
    expect(screen.getByText("改 token")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开会话" }));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession).toHaveBeenCalledWith("radii");

    rerender(
      <DockDetail
        selection={{ kind: "issue", issue: radii }}
        actionLabel="切到会话"
        onOpenSession={onOpenSession}
      />,
    );
    expect(screen.getByRole("button", { name: "切到会话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开会话" })).toBeNull();

    rerender(
      <DockDetail
        selection={{ kind: "issue", issue: radii }}
        actionLabel={null}
        onOpenSession={onOpenSession}
      />,
    );
    expect(screen.queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "切到会话" })).toBeNull();
  });

  it("keeps the title and actions in the toolbar and lists issues in the right rail", async () => {
    const railThreshold = DOCK_DETAIL_RAIL_WIDTH + DOCK_DETAIL_RAIL_MIN_CONTENT;
    expect(dockDetailRailFits(0)).toBe(false);
    expect(dockDetailRailFits(700)).toBe(false);
    expect(dockDetailRailFits(railThreshold - 1)).toBe(false);
    expect(dockDetailRailFits(railThreshold)).toBe(true);
    expect(dockDetailRailFits(1200)).toBe(true);

    const user = userEvent.setup();
    const onSelectIssue = vi.fn();
    const radii = issue({
      issueId: "radii",
      title: RADII,
      priority: "p1",
      items: RADII_ITEMS,
    });
    const issues = [
      { issueId: "radii", title: RADII, type: "bug", presence: "running" as const },
      { issueId: "a11y", title: A11Y, type: "review", presence: null },
    ];
    const restore = stubClientWidth(1200);
    try {
      render(
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel="打开会话"
          issues={issues}
          onSelectIssue={onSelectIssue}
          onOpenSession={vi.fn()}
        />,
      );
    } finally {
      restore();
    }

    const toolbar = screen.getByTestId("dock-detail-toolbar");
    expect(within(toolbar).getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(within(toolbar).getByText("空闲")).toBeInTheDocument();
    expect(within(toolbar).getByText("P1")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "打开会话" })).toBeInTheDocument();

    const rail = screen.getByTestId("dock-detail-rail");
    expect(rail).toHaveAttribute("data-mode", "column");
    expect(within(rail).getByTestId("desktop-session-status-running")).toBeInTheDocument();
    expect(within(rail).getByTestId("issue-type-review")).toBeInTheDocument();

    await user.click(within(rail).getByRole("button", { name: new RegExp(A11Y) }));
    expect(onSelectIssue).toHaveBeenCalledWith("a11y");

    await user.click(screen.getByTestId("dock-detail-issues-toggle"));
    expect(screen.getByTestId("dock-detail-rail")).toHaveAttribute(
      "data-open",
      "false",
    );

    cleanup();
    const narrow = stubClientWidth(640);
    try {
      render(
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel="打开会话"
          issues={issues}
          onSelectIssue={onSelectIssue}
          onOpenSession={vi.fn()}
        />,
      );
    } finally {
      narrow();
    }
    expect(screen.queryByTestId("dock-detail-rail")).toBeNull();

    await user.click(screen.getByTestId("dock-detail-issues-toggle"));
    expect(screen.getByTestId("dock-detail-rail")).toHaveAttribute("data-mode", "peek");
  });

  it("previews a completed issue from the archive without switching the selection", async () => {
    const user = userEvent.setup();
    const restore = stubClientWidth(1200);
    try {
      render(
        <DockDetail
          selection={{
            kind: "issue",
            issue: issue({ issueId: "radii", title: RADII, priority: "p1" }),
          }}
          actionLabel="打开会话"
          issues={[]}
          closedIssues={[
            {
              issueId: "done",
              title: "分页格式统一",
              priority: "p1",
              status: "completed",
              statusLabel: "已完成",
              closeNote: "完成，改动 `2` 个文件",
              closedAt: Date.now(),
            },
          ]}
          onOpenSession={vi.fn()}
        />,
      );
    } finally {
      restore();
    }

    const toolbarBefore = screen.getByTestId("dock-detail-toolbar");
    expect(within(toolbarBefore).getByRole("heading", { name: RADII })).toBeInTheDocument();

    const rail = screen.getByTestId("dock-detail-rail");
    expect(rail).toHaveAttribute("data-mode", "column");
    expect(
      within(rail).getByTestId("dock-detail-rail-closed-toggle"),
    ).toHaveTextContent("已完成");
    expect(screen.queryByTestId("dock-detail-rail-closed-rows")).toBeNull();

    await user.click(within(rail).getByTestId("dock-detail-rail-closed-toggle"));
    expect(screen.getByTestId("dock-detail-rail-closed-rows")).toBeInTheDocument();
    expect(within(rail).getByText("今天")).toBeInTheDocument();
    await user.click(
      within(rail).getByRole("button", { name: /分页格式统一/ }),
    );

    const toolbar = screen.getByTestId("dock-detail-toolbar");
    expect(within(toolbar).getByRole("heading", { name: "分页格式统一" })).toBeInTheDocument();
    expect(within(toolbar).getByText("已完成")).toBeInTheDocument();
    expect(screen.getByTestId("dock-detail-result")).toHaveTextContent(
      "完成，改动 2 个文件",
    );
    // Closed issues are read-only: no session / IDE / Finder actions, only the
    // list toggle remains.
    expect(within(toolbar).queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(within(toolbar).queryByRole("button", { name: "在 IDE 中打开" })).toBeNull();
    expect(within(toolbar).getByTestId("dock-detail-issues-toggle")).toBeInTheDocument();
  });

  it("shows the issue rail on the empty detail page", async () => {
    const user = userEvent.setup();
    const onSelectIssue = vi.fn();
    const restore = stubClientWidth(1200);
    try {
      render(
        <DockDetail
          selection={{ kind: "none" }}
          actionLabel={null}
          issues={[
            { issueId: "radii", title: RADII, priority: "p1", statusLabel: "空闲" },
          ]}
          closedIssues={[]}
          onSelectIssue={onSelectIssue}
          onOpenSession={vi.fn()}
        />,
      );
    } finally {
      restore();
    }

    expect(screen.getByTestId("dock-detail-empty")).toBeInTheDocument();
    const rail = screen.getByTestId("dock-detail-rail");
    expect(rail).toHaveAttribute("data-mode", "column");
    await user.click(within(rail).getByRole("button", { name: new RegExp(RADII) }));
    expect(onSelectIssue).toHaveBeenCalledWith("radii");
  });

  it("loads the closed archive one page at a time", async () => {
    const user = userEvent.setup();
    const closed = Array.from({ length: 20 }, (_, index) => ({
      issueId: `done-${index}`,
      title: `已完成事项 ${index + 1}`,
      priority: "p1",
      status: "completed",
      statusLabel: "已完成",
      closedAt: Date.now() - index * 60_000,
    }));
    const onLoadClosedIssues = vi.fn(async () => ({
      issues: [
        {
          issueId: "done-more",
          title: "更早完成的事项",
          priority: "p2",
          status: "completed",
          statusLabel: "已完成",
          closedAt: Date.now() - 86_400_000,
        },
      ],
      hasMore: false,
      total: 21,
    }));
    const restore = stubClientWidth(1200);
    try {
      render(
        <DockDetail
          selection={{ kind: "issue", issue: issue({ issueId: "radii", title: RADII, priority: "p1" }) }}
          actionLabel={null}
          issues={[]}
          closedIssues={closed}
          onLoadClosedIssues={onLoadClosedIssues}
          onOpenSession={vi.fn()}
        />,
      );
    } finally {
      restore();
    }

    await user.click(screen.getByTestId("dock-detail-rail-closed-toggle"));
    await user.click(screen.getByTestId("dock-detail-rail-load-more"));
    expect(onLoadClosedIssues).toHaveBeenCalledWith(20, 20);
    expect(await screen.findByText("更早完成的事项")).toBeInTheDocument();
    expect(screen.queryByTestId("dock-detail-rail-load-more")).toBeNull();
    await user.click(screen.getByText("更早完成的事项"));
    expect(
      within(screen.getByTestId("dock-detail-toolbar")).getByRole("heading", {
        name: "更早完成的事项",
      }),
    ).toBeInTheDocument();
  });

  it("keeps cancelled issues hidden until 显示已取消 is toggled", async () => {
    const user = userEvent.setup();
    const done = issue({
      issueId: "done",
      title: "分页格式统一",
      priority: "p1",
      status: "completed",
    });
    const restore = stubClientWidth(1200);
    try {
      render(
        <DockDetail
          selection={{ kind: "issue", issue: done }}
          actionLabel={null}
          issues={[]}
          closedIssues={[
            {
              issueId: "done",
              title: "分页格式统一",
              priority: "p1",
              statusLabel: "已完成",
              closedAt: Date.now(),
            },
            {
              issueId: "dropped",
              title: "已放弃的方案",
              priority: "p2",
              statusLabel: "已取消",
              cancelled: true,
              closedAt: Date.now(),
            },
          ]}
          onOpenSession={vi.fn()}
        />,
      );
    } finally {
      restore();
    }

    await user.click(screen.getByTestId("dock-detail-rail-closed-toggle"));
    expect(screen.queryByTestId("dock-detail-rail-cancelled")).toBeNull();
    expect(screen.queryByText("已放弃的方案")).toBeNull();

    const toggle = screen.getByTestId("dock-detail-rail-cancelled-toggle");
    expect(toggle).toHaveTextContent("显示已取消 1");
    await user.click(toggle);
    expect(screen.getByTestId("dock-detail-rail-cancelled")).toBeInTheDocument();
    expect(screen.getByText("已放弃的方案")).toBeInTheDocument();
    expect(toggle).toHaveTextContent("隐藏已取消");
  });

  it("loads the description of a closed issue on demand", async () => {
    const done = issue({
      issueId: "done",
      title: "分页格式统一",
      priority: "p1",
      status: "completed",
      closeNote: "完成",
    });
    const onLoadIssue = vi.fn(async () => ({
      description: "三条问题（同一沙箱，0→1 链路）",
      items: [{ id: "one", content: "统一页脚", status: "done" }],
    }));
    render(
      <DockDetail
        selection={{ kind: "issue", issue: done }}
        actionLabel={null}
        issues={[]}
        closedIssues={[]}
        onLoadIssue={onLoadIssue}
        onOpenSession={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("dock-detail-description")).toHaveTextContent(
      "三条问题（同一沙箱，0→1 链路）",
    );
    expect(onLoadIssue).toHaveBeenCalledWith("done");
    expect(screen.getByTestId("dock-detail-checklist")).toHaveTextContent(
      "统一页脚",
    );
  });

  it("loads the description of an open issue on demand", async () => {
    const open = issue({
      issueId: "open",
      title: "进行中",
      priority: "p1",
      status: "executing",
      description: "",
      updatedAt: 42,
    });
    const onLoadIssue = vi.fn(async () => ({
      description: "活跃事项的完整正文",
      items: [],
    }));
    render(
      <DockDetail
        selection={{ kind: "issue", issue: open }}
        actionLabel={null}
        issues={[]}
        closedIssues={[]}
        onLoadIssue={onLoadIssue}
        onOpenSession={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("dock-detail-description")).toHaveTextContent(
      "活跃事项的完整正文",
    );
    expect(onLoadIssue).toHaveBeenCalledWith("open");
  });

  it("renders description markdown and checklist status", () => {
    const radii = issue({
      issueId: "radii",
      title: RADII,
      priority: "p1",
      items: [
        { id: "measure", content: "量一下 `圆角`", status: "pending" },
        { id: "token", content: "改 **token**", status: "done" },
        { id: "run", content: "正在改", status: "running" },
      ],
    });
    render(
      <DockDetail
        selection={{
          kind: "issue",
          issue: {
            ...radii,
            description: "先看 **方案**\n\n- 核对调用",
          },
        }}
        actionLabel={null}
        onOpenSession={vi.fn()}
      />,
    );

    const description = screen.getByTestId("dock-detail-description");
    expect(description.querySelector("strong")).toHaveTextContent("方案");
    expect(description.querySelector("li")).toHaveTextContent("核对调用");

    const checklist = screen.getByTestId("dock-detail-checklist");
    expect(within(checklist).getByText("进行中 1")).toBeInTheDocument();
    expect(within(checklist).getByText("待办 1")).toBeInTheDocument();
    expect(within(checklist).getByText("完成 1")).toBeInTheDocument();
    const rows = checklist.querySelectorAll(".dock-detail-check-list li");
    expect(rows[0]).toHaveAttribute("data-status", "running");
    expect(rows[1]).toHaveAttribute("data-status", "pending");
    expect(rows[2]).toHaveAttribute("data-status", "done");
    expect(checklist.querySelector("code")).toHaveTextContent("圆角");
    expect(checklist.querySelector("strong")).toHaveTextContent("token");
  });

  it("shows two lines of a checklist item until 查看 is clicked", async () => {
    const user = userEvent.setup();
    const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(80);
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(32);
    const radii = issue({
      issueId: "radii",
      title: RADII,
      priority: "p1",
      items: [{ id: "long", content: "第一行\n\n第二行后面还有很多说明", status: "done" }],
    });
    render(
      <DockDetail
        selection={{ kind: "issue", issue: radii }}
        actionLabel={null}
        onOpenSession={vi.fn()}
      />,
    );

    const checklist = screen.getByTestId("dock-detail-checklist");
    const row = checklist.querySelector(".dock-detail-check-list li");
    expect(row?.querySelector(".dock-detail-check-body")).toHaveClass("is-collapsed");
    await user.click(within(checklist).getByRole("button", { name: "查看" }));
    expect(within(checklist).getByRole("button", { name: "收起" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(row?.querySelector(".dock-detail-check-body")).not.toHaveClass("is-collapsed");
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });

  it("shows a queue item's type, title, and body without an open button", () => {
    render(
      <DockDetail
        selection={{
          kind: "queue",
          typeLabel: "聊天",
          title: QUEUE_TITLE,
          body: QUEUE_BODY,
        }}
        actionLabel="打开会话"
        onOpenSession={vi.fn()}
      />,
    );

    const detail = screen.getByTestId("dock-detail");
    expect(within(detail).getByText("聊天")).toBeInTheDocument();
    expect(within(detail).getByText(QUEUE_TITLE)).toBeInTheDocument();
    expect(within(detail).getByText(QUEUE_BODY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "切到会话" })).toBeNull();
  });

  it("shows an empty state when nothing is selected", () => {
    render(
      <DockDetail
        selection={{ kind: "none" }}
        actionLabel={null}
        onOpenSession={vi.fn()}
      />,
    );

    expect(screen.getByTestId("dock-detail-empty")).toHaveTextContent(
      "选择一个事项查看详情",
    );
  });

  it("clamps the rail width and keeps a readable detail column", () => {
    expect(clampDockDetailRailWidth(120)).toBe(DOCK_DETAIL_RAIL_MIN_WIDTH);
    expect(clampDockDetailRailWidth(999)).toBe(DOCK_DETAIL_RAIL_MAX_WIDTH);
    expect(clampDockDetailRailWidth(400, 760)).toBe(240);
    expect(clampDockDetailRailWidth(300, 700)).toBe(DOCK_DETAIL_RAIL_MIN_WIDTH);
    expect(dockDetailRailFits(800, 300)).toBe(false);
    expect(dockDetailRailFits(820, 300)).toBe(true);
  });

  it("can select a closed issue without switching the active tab", () => {
    const state = {
      ...initialBotWorkspace("radii"),
      active: "radii",
      openIssueIds: ["radii", "done"],
      panel: { kind: "issue" as const, issueId: "radii" },
    };
    const preview = applySelectPanel(
      state,
      { kind: "issue", issueId: "done" },
      { followTab: false },
    );
    expect(preview.active).toBe("radii");
    expect(preview.panel).toEqual({ kind: "issue", issueId: "done" });
    const followed = applySelectPanel(state, {
      kind: "issue",
      issueId: "done",
    });
    expect(followed.active).toBe("done");
  });

  it("selectDock changes the dock tab and leaves the selected panel alone", () => {
    const { result } = renderHook(() => useBotWorkspaceController("radii"));
    expect(result.current.dock).toBe("detail");
    expect(result.current.panel).toEqual({ kind: "issue", issueId: "radii" });

    act(() => {
      result.current.selectDock("file");
    });
    expect(result.current.dock).toBe("file");
    expect(result.current.panel).toEqual({ kind: "issue", issueId: "radii" });
    expect(result.current.active).toBe("bot");

    act(() => {
      result.current.selectPanel({ kind: "queue", id: "ty" });
    });
    expect(result.current.dock).toBe("detail");
    expect(result.current.panel).toEqual({ kind: "queue", id: "ty" });
  });
});

describe("assistant dock detail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWebviewStores();
  });

  it("inserts a new terminal after the current tab", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [
              issue({
                issueId: "radii",
                title: RADII,
                priority: "p1",
                items: RADII_ITEMS,
              }),
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(tabLabels()).toEqual([RADII]);
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-diff"));
    expect(tabLabels()).toEqual([RADII, "变更"]);
    await user.click(within(dock).getByRole("button", { name: "变更" }));
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-terminal"));
    expect(tabLabels()).toEqual([RADII, "变更", "radii"]);
  });

  it("keeps a closed issue selected from the rail after the tab prune", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    const closed = issue({
      issueId: "done",
      title: "页脚间距统一",
      priority: "p2",
      status: "completed",
      closeNote: "三份页面都统一为 24px。",
    });
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [
              issue({
                issueId: "radii",
                title: RADII,
                priority: "p1",
                items: RADII_ITEMS,
              }),
            ],
            closedIssueGroups: [closed],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByTestId("dock-detail-issues-toggle"));
    const rail = within(dock).getByTestId("dock-detail-rail");
    await user.click(within(rail).getByTestId("dock-detail-rail-closed-toggle"));
    await user.click(
      within(rail).getByRole("button", { name: /页脚间距统一/ }),
    );

    expect(within(dock).queryByTestId("dock-detail-empty")).toBeNull();
    expect(
      within(dock).getByRole("heading", { name: "页脚间距统一" }),
    ).toBeInTheDocument();
    expect(within(dock).getByTestId("dock-detail-result")).toHaveTextContent(
      "三份页面都统一为 24px。",
    );
  });

  it("shows 详情 again after the last kind panel closes", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file", "diff"],
      mounted: ["file", "diff"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [
              issue({
                issueId: "radii",
                title: RADII,
                priority: "p1",
                items: RADII_ITEMS,
              }),
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "文件" }));

    await user.click(within(dock).getByTestId("desktop-panel-tab-close-file"));
    await user.click(within(dock).getByTestId("desktop-panel-tab-close-diff"));
    expect(await within(dock).findByTestId("dock-detail")).toBeVisible();
    expect(within(dock).getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(within(dock).queryByTestId("desktop-panel-tab-file")).toBeNull();
  });

  it("stays on 详情 when another kind is still open", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file", "terminal", "diff"],
      mounted: ["file", "terminal", "diff"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [
              issue({
                issueId: "radii",
                title: RADII,
                priority: "p1",
                items: RADII_ITEMS,
              }),
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(within(dock).getByTestId("dock-detail")).toBeVisible();

    await user.click(within(dock).getByTestId("desktop-panel-tab-close-file"));

    expect(within(dock).getByTestId("dock-detail")).toBeVisible();
    expect(within(dock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    const terminal = within(dock).queryByTestId("terminal-pane");
    if (terminal) expect(terminal).not.toBeVisible();
  });

  it("activates 终端 when the current 文件 tab closes", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file", "terminal", "preview", "diff"],
      mounted: ["file", "terminal", "preview", "diff"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "文件" }));
    expect(within(dock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(within(dock).getByTestId("desktop-panel-tab-close-file"));

    expect(within(dock).getByTestId("desktop-panel-tab-terminal")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dock).getByTestId("desktop-panel-tab-preview")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });

  it("keeps 详情 when switching from Muse Bot to a session with a different active kind", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    expect(
      within(assistantDock).getByTestId("desktop-panel-tab-detail"),
    ).toHaveClass("desktop-panel-tab--active");
    expect(
      within(assistantDock).getByTestId("desktop-panel-tab-file"),
    ).not.toHaveClass("desktop-panel-tab--active");

    establishSession();
    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    expect(within(sessionDock).queryByTestId("desktop-panel-tab-detail")).toBeNull();
    expect(
      within(sessionDock).getByTestId("desktop-panel-tab-terminal"),
    ).toHaveClass("desktop-panel-tab--active");
  });

  it("returns to 详情 when switching onto a panel group with no kinds", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByRole("button", { name: "文件" }));
    expect(within(assistantDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    establishSession();
    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    expect(within(chat).queryByTestId("desktop-panel-dock")).toBeNull();

    act(() => {
      usePanelGroupStore.getState().patchGroup("/mock/workdir", {
        checked: ["file"],
        mounted: ["file"],
        active: "file",
      });
    });
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    await user.click(within(sessionDock).getByRole("button", { name: "文件" }));
    expect(within(sessionDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    act(() => {
      usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        checked: [],
        mounted: [],
        active: null,
      });
    });
    await user.click(screen.getByTestId("desktop-assistant-menu"));

    const assistantAgain = await screen.findByTestId("assistant-frame");
    const emptyAssistantDock = within(assistantAgain).getByTestId("desktop-panel-dock");
    expect(within(emptyAssistantDock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(emptyAssistantDock).getByTestId("dock-detail")).toBeVisible();
  });

  it("keeps 文件 when 设置 is opened and Muse Bot is shown again", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByRole("button", { name: "文件" }));
    expect(within(assistantDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(screen.getByTestId("desktop-settings-btn"));
    expect(await screen.findByTestId("desktop-settings-page")).toBeInTheDocument();

    await user.click(screen.getByTestId("desktop-assistant-menu"));

    const assistantAgain = await screen.findByTestId("assistant-frame");
    const dock = within(assistantAgain).getByTestId("desktop-panel-dock");
    expect(within(dock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dock).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });

  it("keeps 文件 when the pane paints the dock and the shell host has a session", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const user = userEvent.setup();
    const host = createMockDesktopHost({
      panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
      focusedPaneId: "pane-1",
    });
    const view = render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={host} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "文件" }));
    expect(within(dock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    establishSession();
    view.rerender(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={{ ...host }} />
      </MuseTheme>,
    );

    const painted = await screen.findByTestId("assistant-frame");
    const paintedDock = within(painted).getByTestId("desktop-panel-dock");
    expect(within(paintedDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(paintedDock).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(screen.getByTestId("desktop-settings-btn"));
    expect(await screen.findByTestId("desktop-settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-panel-dock")).toBeNull();

    await user.click(screen.getByTestId("desktop-assistant-menu"));
    const assistantAgain = await screen.findByTestId("assistant-frame");
    const dockAgain = within(assistantAgain).getByTestId("desktop-panel-dock");
    expect(within(dockAgain).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dockAgain).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });

  it("shows 详情 when the session group does not have the chrome kind", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByRole("button", { name: "文件" }));
    expect(within(assistantDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    establishSession();
    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    expect(within(sessionDock).queryByTestId("desktop-panel-tab-detail")).toBeNull();
    expect(within(sessionDock).getByTestId("desktop-panel-tab-terminal")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(sessionDock).getByTestId("terminal-pane")).toBeVisible();
  });

  it("switches session dock tabs after 浏览器 is the shared chrome", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      checked: ["preview", "diff", "file"],
      mounted: ["preview", "diff", "file"],
      active: "diff",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-preview"));

    establishSession();
    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    expect(within(sessionDock).getByTestId("desktop-panel-tab-preview")).toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(within(sessionDock).getByRole("button", { name: "变更" }));
    expect(within(sessionDock).getByTestId("desktop-panel-tab-diff")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(sessionDock).getByTestId("desktop-panel-tab-preview")).not.toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(within(sessionDock).getByRole("button", { name: "文件" }));
    expect(within(sessionDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(sessionDock).getByTestId("desktop-panel-tab-diff")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });

  it("keeps 文件 when the session group has that kind but another kind is active", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      checked: ["file", "terminal"],
      mounted: ["file", "terminal"],
      active: "terminal",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByRole("button", { name: "文件" }));
    expect(within(assistantDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    establishSession();
    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    expect(within(sessionDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(sessionDock).queryByTestId("desktop-panel-tab-detail")).toBeNull();
    expect(within(sessionDock).getByTestId("desktop-panel-tab-terminal")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(sessionDock).getByTestId("terminal-pane")).not.toBeVisible();
  });

  it("selects 终端 when 文件 closes while the group active kind is already 终端", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      checked: ["file", "terminal"],
      mounted: ["file", "terminal"],
      active: "terminal",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByRole("button", { name: "文件" }));

    establishSession();
    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    expect(within(sessionDock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(within(sessionDock).getByTestId("desktop-panel-tab-close-file"));

    expect(within(sessionDock).getByTestId("desktop-panel-tab-terminal")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(sessionDock).queryByTestId("desktop-panel-tab-detail")).toBeNull();
  });

  it("keeps 文件 when another pane checks only 终端", async () => {
    // React logs this from useEffect and keeps rendering. Rethrow so a
    // regression fails the suite instead of hanging it.
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((part) => String(part)).join(" ");
      if (text.includes("Maximum update depth")) {
        console.error = originalError;
        throw new Error(text);
      }
      originalError(...(args as Parameters<typeof console.error>));
    };
    try {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        checked: ["file"],
        mounted: ["file"],
        active: "file",
        fileTree: { ...emptyFileTreeState(), collapsed: false },
      });
      usePanelGroupStore.getState().patchGroup("/work/pane-b", {
        checked: ["terminal"],
        mounted: ["terminal"],
        active: "terminal",
      });
      const user = userEvent.setup();
      const panes = [
        { paneId: "pane-a", sessionId: "sess-a" },
        { paneId: "pane-b", sessionId: "sess-b" },
      ];
      const host = createMockDesktopHost({
        panes,
        focusedPaneId: "pane-a",
      });
      const view = render(
        <MuseTheme>
          <ChatApp vscode={createMockVscode()} host={host} />
        </MuseTheme>,
      );
      sendHostMessage(
        fixtures.setInitialState({
          paneId: "pane-b",
          workdir: "/work/pane-b",
          messages: [],
          isAuthenticated: true,
          session: {
            id: "sess-b",
            sessionType: "main",
            workdir: "/work/pane-b",
            createdAt: new Date(),
            lastActiveAt: new Date(),
            latestTotalTokens: 0,
          },
        }),
      );

      const frame = await screen.findByTestId("assistant-frame");
      const paneB = await screen.findByTestId("desktop-pane-pane-b");
      expect(
        await within(paneB).findByTestId("desktop-panel-tab-terminal"),
      ).toBeInTheDocument();
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "文件" }));

      expect(within(dock).getByTestId("desktop-panel-tab-file")).toHaveClass(
        "desktop-panel-tab--active",
      );
      expect(within(dock).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
        "desktop-panel-tab--active",
      );

      view.rerender(
        <MuseTheme>
          <ChatApp
            vscode={createMockVscode()}
            host={{
              ...host,
              panes: [...panes, { paneId: "pane-c", sessionId: "sess-c" }],
            }}
          />
        </MuseTheme>,
      );
      sendHostMessage(
        fixtures.setInitialState({
          paneId: "pane-c",
          workdir: "/work/pane-c",
          messages: [],
          isAuthenticated: true,
          session: {
            id: "sess-c",
            sessionType: "main",
            workdir: "/work/pane-c",
            createdAt: new Date(),
            lastActiveAt: new Date(),
            latestTotalTokens: 0,
          },
        }),
      );

      const frameAfter = await screen.findByTestId("assistant-frame");
      const dockAfter = within(frameAfter).getByTestId("desktop-panel-dock");
      expect(within(dockAfter).getByTestId("desktop-panel-tab-file")).toHaveClass(
        "desktop-panel-tab--active",
      );
      expect(
        within(dockAfter).getByTestId("desktop-panel-tab-detail"),
      ).not.toHaveClass("desktop-panel-tab--active");
    } finally {
      console.error = originalError;
    }
  });

  it("keeps 终端 when focus moves to a pane that does not have 文件", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/pane-a", {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/work/pane-b", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const user = userEvent.setup();
    const vscode = createMockVscode();
    const view = render(
      <MuseTheme>
        <TwoSessionPanes focusedPaneId="pane-a" vscode={vscode} />
      </MuseTheme>,
    );
    sendHostMessage(
      fixtures.setInitialState({
        paneId: "pane-a",
        workdir: "/work/pane-a",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "sess-a",
          sessionType: "main",
          workdir: "/work/pane-a",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );
    sendHostMessage(
      fixtures.setInitialState({
        paneId: "pane-b",
        workdir: "/work/pane-b",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "sess-b",
          sessionType: "main",
          workdir: "/work/pane-b",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );

    const paneA = await screen.findByTestId("desktop-pane-pane-a");
    const dockA = await within(paneA).findByTestId("desktop-panel-dock");
    await user.click(within(dockA).getByRole("button", { name: "文件" }));
    expect(within(dockA).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );

    view.rerender(
      <MuseTheme>
        <TwoSessionPanes focusedPaneId="pane-b" vscode={vscode} />
      </MuseTheme>,
    );

    const paneB = await screen.findByTestId("desktop-pane-pane-b");
    const dockB = await within(paneB).findByTestId("desktop-panel-dock");
    expect(within(dockB).queryByTestId("desktop-panel-tab-detail")).toBeNull();
    expect(within(dockB).queryByTestId("dock-detail")).toBeNull();
    expect(within(dockB).getByTestId("desktop-panel-tab-terminal")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dockB).getByTestId("terminal-pane")).toBeVisible();
    const paneAAfter = await screen.findByTestId("desktop-pane-pane-a");
    expect(
      within(paneAAfter).getByTestId("desktop-panel-tab-file"),
    ).toHaveClass("desktop-panel-tab--active");
  });

  it("keeps an unfocused pane on its own kind when it lacks the chrome kind", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/pane-a", {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/work/pane-b", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const user = userEvent.setup();
    const vscode = createMockVscode();
    render(
      <MuseTheme>
        <TwoSessionPanes focusedPaneId="pane-a" vscode={vscode} />
      </MuseTheme>,
    );
    sendHostMessage(
      fixtures.setInitialState({
        paneId: "pane-a",
        workdir: "/work/pane-a",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "sess-a",
          sessionType: "main",
          workdir: "/work/pane-a",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );
    sendHostMessage(
      fixtures.setInitialState({
        paneId: "pane-b",
        workdir: "/work/pane-b",
        messages: [],
        isAuthenticated: true,
        session: {
          id: "sess-b",
          sessionType: "main",
          workdir: "/work/pane-b",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );

    const paneA = await screen.findByTestId("desktop-pane-pane-a");
    const dockA = await within(paneA).findByTestId("desktop-panel-dock");
    await user.click(within(dockA).getByRole("button", { name: "文件" }));

    expect(within(dockA).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dockA).queryByTestId("desktop-panel-tab-detail")).toBeNull();

    const paneB = await screen.findByTestId("desktop-pane-pane-b");
    const dockB = await within(paneB).findByTestId("desktop-panel-dock");
    expect(within(dockB).queryByTestId("dock-detail")).toBeNull();
    expect(within(dockB).getByTestId("desktop-panel-tab-terminal")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dockB).getByTestId("terminal-pane")).toBeVisible();

    expect(within(dockA).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
  });
});

  it("shows progress, changed files and artifacts", async () => {
    const user = userEvent.setup();
    const onOpenChangedFile = vi.fn();
    const onOpenArtifact = vi.fn();
    const radii = issue({
      issueId: "radii",
      title: RADII,
      priority: "p1",
      updates: [
        {
          id: "u-1",
          at: Date.now(),
          kind: "assistant",
          summary: "圆角已对齐，报告已出。",
          next: "等按钮高度统一后收口。",
          changedFiles: ["/work/radii/src/a.ts"],
          files: ["/work/radii/report.html", "/work/radii/shot.png"],
        },
      ],
      updateCount: 1,
    });
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel="打开会话"
          onOpenSession={() => {}}
          onOpenChangedFile={onOpenChangedFile}
          onOpenArtifact={onOpenArtifact}
        />
      </MuseTheme>,
    );

    expect(screen.getByTestId("dock-detail-progress")).toBeInTheDocument();
    const progress = within(screen.getByTestId("dock-detail-progress"));
    expect(progress.getByText("圆角已对齐，报告已出。")).toBeInTheDocument();
    expect(progress.getByText("等按钮高度统一后收口。")).toBeInTheDocument();
    expect(screen.getByTestId("dock-detail-changes")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("dock-detail-artifacts")).toBeInTheDocument();

    const artifacts = ["/work/radii/report.html", "/work/radii/shot.png"];
    await user.click(screen.getByText("a.ts"));
    expect(onOpenChangedFile).toHaveBeenCalledWith("/work/radii/src/a.ts");
    await user.click(screen.getByText("report.html"));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      "/work/radii/report.html",
      undefined,
      artifacts,
    );
    await user.click(screen.getByRole("button", { name: "预览 shot.png" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      "/work/radii/shot.png",
      undefined,
      artifacts,
    );
  });

  it("renders a pending permission as read-only", () => {
    const now = Date.now();
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: [
        {
          id: "perm-1",
          at: now,
          kind: "permission" as const,
          summary: "等待批准：Bash",
          detail: "运行 npm test",
          sessionId: "plan-radii",
          permissionId: "perm-1",
        },
      ],
      updateCount: 1,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          onOpenSession={() => {}}
        />
      </MuseTheme>,
    );

    const card = screen.getByTestId("dock-detail-permission");
    expect(card).toHaveTextContent("等待批准：Bash");
    expect(
      within(card).queryByRole("button", { name: "允许" }),
    ).toBeNull();
    expect(
      within(card).queryByRole("button", { name: "拒绝" }),
    ).toBeNull();
    expect(card).toHaveTextContent("在对话里的确认框处理这次审批");
  });

  it("hides a permission card once its session is no longer waiting", () => {
    const now = Date.now();
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: [
        {
          id: "perm-1",
          at: now,
          kind: "permission" as const,
          summary: "等待批准：AskUserQuestion",
          sessionId: "plan-radii",
          permissionId: "perm-1",
        },
      ],
    };
    const view = render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          currentSessionId="plan-radii"
          pendingPermissionIds={new Set(["perm-1"])}
          onOpenSession={() => {}}
        />
      </MuseTheme>,
    );
    expect(screen.getByTestId("dock-detail-permission")).toBeInTheDocument();

    view.rerender(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          currentSessionId="plan-radii"
          pendingPermissionIds={new Set()}
          onOpenSession={() => {}}
        />
      </MuseTheme>,
    );
    expect(screen.queryByTestId("dock-detail-permission")).toBeNull();
  });

  it("hides permission progress the server already marked resolved", () => {
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: [
        {
          id: "perm-1",
          at: Date.now(),
          kind: "permission" as const,
          summary: "等待批准：AskUserQuestion",
          sessionId: "plan-radii",
          permissionId: "perm-1",
          resolved: true,
        },
      ],
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          onOpenSession={() => {}}
        />
      </MuseTheme>,
    );
    expect(screen.queryByTestId("dock-detail-permission")).toBeNull();
  });

  it("completes an issue directly with a generated note", async () => {
    const user = userEvent.setup();
    const onCompleteIssue = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.spyOn(window, "postMessage");
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: [
        {
          id: "u1",
          at: Date.now(),
          kind: "assistant" as const,
          summary: "圆角和间距都修完了",
        },
      ],
      updateCount: 1,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          onOpenSession={() => {}}
          onCompleteIssue={onCompleteIssue}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByTestId("dock-detail-close-preview")).toHaveTextContent(
      "圆角和间距都修完了",
    );
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByTestId("dock-detail-close-note")).toHaveValue(
      "圆角和间距都修完了",
    );
    await user.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onCompleteIssue).toHaveBeenCalledWith("radii", "圆角和间距都修完了");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({
          message: expect.stringContaining("已完成"),
        }),
      }),
      "*",
    );
    postMessage.mockRestore();
    expect(screen.queryByTestId("confirm-dialog-overlay")).toBeNull();
  });

  it("fills the completion note with the issue AI summary", async () => {
    const user = userEvent.setup();
    let resolveSummary!: (value: string) => void;
    const onGenerateSummary = vi.fn(
      () => new Promise<string>((resolve) => { resolveSummary = resolve; }),
    );
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: [
        {
          id: "u1",
          at: Date.now(),
          kind: "assistant" as const,
          summary: "fallback note",
        },
      ],
      updateCount: 1,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          onOpenSession={() => {}}
          onCompleteIssue={vi.fn()}
          onGenerateSummary={onGenerateSummary}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByTestId("dock-detail-close-loading")).toBeInTheDocument();
    resolveSummary("AI 生成的结果总结");
    expect(await screen.findByText("AI 生成的结果总结")).toBeInTheDocument();
    expect(screen.queryByTestId("dock-detail-close-loading")).toBeNull();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByDisplayValue("AI 生成的结果总结")).toBeInTheDocument();
  });

  it("reuses the AI summary until progress changes", async () => {
    const user = userEvent.setup();
    const onGenerateSummary = vi.fn().mockResolvedValue("缓存的最终结论");
    const cachedIssue = {
      ...issue({ issueId: "cache-test", title: "缓存测试", priority: "p1" }),
      updates: [
        {
          id: "cache-u1",
          at: Date.now(),
          kind: "assistant" as const,
          summary: "fallback note",
        },
      ],
      updateCount: 1,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: cachedIssue }}
          actionLabel={null}
          onOpenSession={() => {}}
          onCompleteIssue={vi.fn()}
          onGenerateSummary={onGenerateSummary}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(await screen.findByText("缓存的最终结论")).toBeInTheDocument();
    await user.click(screen.getByTestId("confirm-dialog-cancel"));
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByText("缓存的最终结论")).toBeInTheDocument();
    expect(onGenerateSummary).toHaveBeenCalledOnce();
  });

  it("deduplicates an in-flight summary request", async () => {
    const user = userEvent.setup();
    let resolveSummary!: (value: string) => void;
    const onGenerateSummary = vi.fn(
      () => new Promise<string>((resolve) => { resolveSummary = resolve; }),
    );
    const dedupeIssue = {
      ...issue({ issueId: "dedupe-test", title: "去重测试", priority: "p1" }),
      updates: [
        {
          id: "dedupe-u1",
          at: Date.now(),
          kind: "assistant" as const,
          summary: "fallback",
        },
      ],
      updateCount: 1,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: dedupeIssue }}
          actionLabel={null}
          onOpenSession={() => {}}
          onCompleteIssue={vi.fn()}
          onGenerateSummary={onGenerateSummary}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByTestId("confirm-dialog-cancel"));
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(onGenerateSummary).toHaveBeenCalledOnce();
    resolveSummary("共享的总结");
    expect(await screen.findByText("共享的总结")).toBeInTheDocument();
  });

  it("loads the full update history on demand", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const base = Array.from({ length: 8 }, (_, index) => ({
      id: `u-${index}`,
      at: now - index,
      kind: "status" as const,
      summary: `状态 ${index}`,
    }));
    const more = Array.from({ length: 10 }, (_, index) => ({
      id: `u-${index}`,
      at: now - index,
      kind: "status" as const,
      summary: `状态 ${index}`,
    }));
    const onLoadUpdates = vi.fn().mockResolvedValue({
      updates: more,
      hasMore: false,
    });
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: base,
      updateCount: 10,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          onOpenSession={() => {}}
          onLoadUpdates={onLoadUpdates}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByRole("button", { name: "查看全部" }));
    expect(onLoadUpdates).toHaveBeenCalledWith("radii", { limit: 30 });
    await user.click(await screen.findByRole("button", { name: "收起" }));
    expect(onLoadUpdates).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "查看全部" })).toBeInTheDocument();
  });

describe("session dock detail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWebviewStores();
  });

  it("does not leave a dead collapse control when full history adds no rows", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const base = [
      {
        id: "primary",
        at: now,
        kind: "assistant" as const,
        summary: "最新进展",
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `status-${index}`,
        at: now - index,
        kind: "status" as const,
        summary: `状态 ${index}`,
      })),
    ];
    const turns = Array.from({ length: 12 }, (_, index) => ({
      id: `turn-${index}`,
      at: now - 100 - index,
      kind: "turn" as const,
      summary: "回合结束",
    }));
    const onLoadUpdates = vi.fn().mockResolvedValue({
      updates: turns,
      hasMore: false,
    });
    const radii = {
      ...issue({ issueId: "radii", title: RADII, priority: "p1" }),
      updates: base,
      updateCount: 20,
    };
    render(
      <MuseTheme>
        <DockDetail
          selection={{ kind: "issue", issue: radii }}
          actionLabel={null}
          onOpenSession={() => {}}
          onLoadUpdates={onLoadUpdates}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByRole("button", { name: "查看全部" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "收起" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "查看全部" })).toBeNull();
    expect(screen.getByText("没有更多")).toBeInTheDocument();
    expect(screen.getByTestId("dock-detail-timeline")).toHaveTextContent(
      "状态 6",
    );
  });

  it("does not show the issue detail tab", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );
    establishSession();

    await user.click(await screen.findByTestId("desktop-sessions-menu"));

    const chat = await screen.findByTestId("chat-container");
    expect(screen.queryByTestId("assistant-frame")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-detail")).toBeNull();
    expect(within(chat).queryByTestId("dock-detail")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-file")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-terminal")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-preview")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-diff")).toBeNull();
  });
});
