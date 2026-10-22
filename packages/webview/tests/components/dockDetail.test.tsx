/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { DockDetail } from "../../src/components/desktop/DockDetail";
import { DesktopPanelDock } from "../../src/components/desktop/DesktopPanelDock";
import { useBotWorkspaceController } from "../../src/components/desktop/BotTabs";
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
} from "../webview/test-utils";

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
    expect(screen.getByText("空闲 · P1")).toBeInTheDocument();
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
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
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
    const dock = await within(frame).findByTestId("desktop-panel-dock");
    expect(tabLabels()).toEqual(["详情", "文件", "终端", "浏览器", "变更"]);

    const detail = await within(dock).findByTestId("dock-detail");
    expect(within(detail).getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(within(detail).getByText("空闲 · P1")).toBeInTheDocument();
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
    expect(within(dock).getByTestId("file-tree-workdir")).toHaveTextContent("proj");
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
    expect(within(nextDetail).getByText("空闲 · P2")).toBeInTheDocument();
    expect(within(nextDetail).getByText("补上焦点环")).toBeInTheDocument();
    expect(within(dock).getByTestId("file-tree")).not.toBeVisible();
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
    expect(within(frame).getByRole("button", { name: /^无障碍检查$/ })).toBeInTheDocument();
    expect(screen.getByText("今天想让我帮你做些什么？")).toBeInTheDocument();
    expect(fetched.some((url) => url.includes("/sessions/"))).toBe(false);

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    expect(within(dock).getByRole("button", { name: "切到会话" })).toBeInTheDocument();
    await user.click(within(dock).getByRole("button", { name: "切到会话" }));
    expect(within(dock).queryByRole("button", { name: "切到会话" })).toBeNull();
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(fetched.some((url) => url.includes("/sessions/"))).toBe(false);
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");

    await user.click(within(lists).getByRole("button", { name: new RegExp(QUEUE_TITLE) }));
    const queueDetail = within(dock).getByTestId("dock-detail");
    expect(within(queueDetail).getByText("聊天")).toBeInTheDocument();
    expect(within(queueDetail).getByText(QUEUE_TITLE)).toBeInTheDocument();
    expect(within(queueDetail).queryByText(QUEUE_BODY)).toBeNull();
    expect(within(queueDetail).queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(within(queueDetail).queryByRole("button", { name: "切到会话" })).toBeNull();
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(frame.querySelectorAll(".bot-tab")).toHaveLength(2);
  });

  it("shows 详情 again after the last kind panel closes", async () => {
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

    const dock = await screen.findByTestId("desktop-panel-dock");
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
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
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

    const dock = await screen.findByTestId("desktop-panel-dock");
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
    const assistantDock = await within(frame).findByTestId("desktop-panel-dock");
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
    expect(within(sessionDock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(
      within(sessionDock).getByTestId("desktop-panel-tab-terminal"),
    ).not.toHaveClass("desktop-panel-tab--active");
  });
});

describe("session dock detail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWebviewStores();
  });

  it("keeps the detail tab when no kind panel is checked", async () => {
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
    expect(within(chat).getByTestId("desktop-panel-tab-detail")).toBeVisible();
    expect(within(chat).queryByTestId("desktop-panel-tab-file")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-terminal")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-preview")).toBeNull();
    expect(within(chat).queryByTestId("desktop-panel-tab-diff")).toBeNull();
  });
});
