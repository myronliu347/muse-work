/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { DockDetail } from "../../src/components/desktop/DockDetail";
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
    Partial<Pick<DesktopIssueGroup, "items">>,
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
          title: "Muse Bot",
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

  it("follows the list selection and does not open a session transcript", async () => {
    resetWebviewStores();
    const fetched: string[] = [];
    stubAssistant(fetched);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["file", "terminal", "preview", "diff"],
      mounted: ["file", "terminal", "preview", "diff"],
      active: "diff",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const onSelectSession = vi.fn();
    const host = createMockDesktopHost({
      onSelectSession,
      issueGroups: [
        issue({
          issueId: "radii",
          title: RADII,
          priority: "p1",
          items: RADII_ITEMS,
        }),
        issue({
          issueId: "a11y",
          title: A11Y,
          priority: "p2",
          items: A11Y_ITEMS,
        }),
      ],
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={host} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(tabLabels()).toEqual([RADII, "文件", "终端", "浏览器", "变更"]);

    const detail = await within(dock).findByTestId("dock-detail");
    expect(within(detail).getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(within(detail).getByText("空闲")).toBeInTheDocument();
    expect(within(detail).getByText("P1")).toBeInTheDocument();
    expect(within(detail).getByText("量一下圆角")).toBeInTheDocument();
    expect(within(detail).getByText("改 token")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "打开会话" })).toBeInTheDocument();
    expect(within(dock).getByTestId("file-tree")).not.toBeVisible();
    expect(within(frame).getByRole("button", { name: "Muse Bot" })).toHaveClass(/active/);
    expect(onSelectSession).not.toHaveBeenCalled();

    const lists = await within(frame).findByTestId("bot-lists");
    expect(within(lists).getByRole("button", { name: new RegExp(RADII) })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await user.click(within(dock).getByRole("button", { name: "文件" }));
    expect(await within(dock).findByTestId("file-tree")).toBeVisible();
    expect(within(dock).getByTestId("file-tree-workdir")).toHaveTextContent("radii");
    expect(within(dock).getByTestId("file-tree-workdir")).toHaveAttribute(
      "title",
      "/work/radii",
    );
    expect(within(dock).getByTestId("dock-detail")).not.toBeVisible();
    expect(within(lists).getByRole("button", { name: new RegExp(RADII) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(onSelectSession).not.toHaveBeenCalled();

    for (const label of ["终端", "浏览器", "变更"] as const) {
      await user.click(within(dock).getByRole("button", { name: label }));
      expect(within(dock).getByTestId("dock-detail")).not.toBeVisible();
      const tree = within(dock).queryByTestId("file-tree");
      if (tree) expect(tree).not.toBeVisible();
      expect(within(lists).getByRole("button", { name: new RegExp(RADII) })).toHaveAttribute(
        "aria-current",
        "true",
      );
    }
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");

    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    const nextDetail = await within(dock).findByTestId("dock-detail");
    expect(within(nextDetail).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(nextDetail).getByText("空闲")).toBeInTheDocument();
    expect(within(nextDetail).getByText("P2")).toBeInTheDocument();
    expect(within(nextDetail).getByText("补上焦点环")).toBeInTheDocument();
    expect(within(dock).queryByTestId("file-tree")).toBeNull();
    expect(within(dock).queryByRole("button", { name: "文件" })).toBeNull();
    expect(within(lists).getByRole("button", { name: new RegExp(A11Y) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(frame).getByRole("button", { name: "Muse Bot" })).toHaveClass(/active/);
    expect(frame.querySelectorAll(".bot-tab")).toHaveLength(1);
    expect(onSelectSession).not.toHaveBeenCalled();

    await user.click(within(nextDetail).getByRole("button", { name: "打开会话" }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");
    expect(screen.getByTestId("desktop-assistant-menu").className).toContain("active");
    expect(within(dock).getByTestId("dock-detail")).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(frame.querySelector(".bot-tab.active .bot-tab-label")).toHaveTextContent(A11Y);
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(A11Y);
    expect(
      await within(within(frame).getByTestId("issue-tab-transcript")).findByTestId(
        "welcome-headline",
      ),
    ).toBeInTheDocument();
    expect(fetched.some((url) => url.includes("/sessions/plan-a11y/messages"))).toBe(true);

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    expect(within(dock).getByRole("button", { name: "切到会话" })).toBeInTheDocument();
    await user.click(within(dock).getByRole("button", { name: "切到会话" }));
    expect(within(dock).queryByRole("button", { name: "切到会话" })).toBeNull();
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(A11Y);
    expect(
      within(within(frame).getByTestId("issue-tab-transcript")).getByTestId("welcome-headline"),
    ).toBeInTheDocument();
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(fetched.some((url) => url.includes("/sessions/plan-a11y/messages"))).toBe(true);
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    const homeLists = within(frame).getByTestId("bot-lists");
    await user.click(within(homeLists).getByRole("button", { name: new RegExp(QUEUE_TITLE) }));
    const queueDetail = within(dock).getByTestId("dock-detail");
    expect(within(queueDetail).getByText("聊天")).toBeInTheDocument();
    expect(within(queueDetail).getByText(QUEUE_TITLE)).toBeInTheDocument();
    expect(within(queueDetail).queryByText(QUEUE_BODY)).toBeNull();
    expect(within(queueDetail).queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(within(queueDetail).queryByRole("button", { name: "切到会话" })).toBeNull();
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(frame.querySelectorAll(".bot-tab")).toHaveLength(2);

    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-file"));
    const expandQueued = within(dock).getByTestId("file-tree-expand-btn");
    if (expandQueued.getAttribute("aria-pressed") !== "true") {
      await user.click(expandQueued);
    }
    const queuedTree = await within(dock).findByTestId("file-tree-workdir");
    expect(queuedTree).toHaveTextContent("a11y");
    expect(queuedTree).toHaveAttribute("title", "/work/a11y");
    expect(queuedTree).not.toHaveTextContent("proj");
  });

  it("shows 详情 again after the last kind panel closes", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["file"],
      mounted: ["file"],
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
    expect(await within(dock).findByTestId("file-tree")).toBeVisible();

    await user.click(within(dock).getByTestId("desktop-panel-tab-close-file"));
    expect(await within(dock).findByTestId("dock-detail")).toBeVisible();
    expect(within(dock).getByTestId("file-tree")).not.toBeVisible();
    expect(within(dock).getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(within(dock).queryByTestId("desktop-panel-tab-file")).toBeNull();
  });

  it("stays on 详情 when another kind is still open", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["file", "terminal"],
      mounted: ["file", "terminal"],
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
    expect(within(dock).getByTestId("file-tree")).not.toBeVisible();
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

  it("returns to 详情 when focus moves to a pane that only has 终端", async () => {
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
    expect(within(dockB).getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dockB).getByTestId("desktop-panel-tab-terminal")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });

  it("shows the detail body on an unfocused pane that lacks the chrome kind", async () => {
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
    expect(within(dockA).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );

    const paneB = await screen.findByTestId("desktop-pane-pane-b");
    const dockB = await within(paneB).findByTestId("desktop-panel-dock");
    const visibleLayer = [
      ...dockB.querySelectorAll(".desktop-panel-dock-layer"),
    ].find((layer) => !layer.hasAttribute("hidden"));
    expect(visibleLayer?.querySelector("[data-testid='dock-detail']")).not.toBeNull();
    expect(within(dockB).getByTestId("dock-detail")).toBeVisible();
    expect(within(dockB).getByTestId("terminal-pane")).not.toBeVisible();

    expect(within(dockA).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dockA).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
  });
});

describe("session dock detail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWebviewStores();
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
