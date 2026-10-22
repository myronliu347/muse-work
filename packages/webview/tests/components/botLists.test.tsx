/** @vitest-environment jsdom */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import {
  BOT_LISTS_WIDE_MIN_WIDTH,
  BotLists,
} from "../../src/components/desktop/BotLists";
import { DesktopShell } from "../../src/components/desktop/DesktopShell";
import type { PanelSelection } from "../../src/components/desktop/botWorkspace";
import { MuseApiClient } from "../../src/muse/apiClient";
import { resetWebviewStores } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import type { DesktopIssueGroup } from "../../src/types";
import { createMockDesktopHost, createMockVscode } from "../webview/test-utils";

const RADII = "圆角还没对齐";
const A11Y = "无障碍检查";
const CLOSED = "已经做完";

function issue(partial: Pick<DesktopIssueGroup, "issueId" | "title" | "priority"> & {
  planningSessionId?: string;
}): DesktopIssueGroup {
  return {
    status: "pending",
    items: [],
    sessions: [],
    ...partial,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubAssistant(queue: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/messages")) {
        return jsonResponse({ messages: [], hasMore: false });
      }
      if (url.includes("/assistant/queue")) {
        return jsonResponse({ items: queue });
      }
      if (url.includes("/assistant/session")) {
        return jsonResponse({
          sessionId: "assistant",
          title: "Muse Bot",
          workdir: "/tmp/proj",
          working: false,
        });
      }
      if (url.includes("/automations")) {
        return jsonResponse({ automations: [] });
      }
      if (url.includes("/scenarios/models")) {
        return jsonResponse({ models: {} });
      }
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

const QUEUE = [
  { type: "chat", title: "回复 Ty" },
  { type: "automation", title: "工作日巡检" },
  { type: "permission", title: "允许读取目录" },
  { type: "issue", title: "分析 wave-agent" },
  { title: "没有类型的事件" },
];

function installMatchMedia() {
  let width = 0;
  type Listener = (event: MediaQueryListEvent) => void;
  const listeners = new Map<string, Set<Listener>>();

  const matchesQuery = (query: string) => {
    const min = /^\(min-width:\s*(\d+)px\)$/.exec(query);
    if (!min) return false;
    return width >= Number(min[1]);
  };

  vi.stubGlobal("matchMedia", (query: string) => {
    let bucket = listeners.get(query);
    if (!bucket) {
      bucket = new Set();
      listeners.set(query, bucket);
    }
    const owned = bucket;
    return {
      media: query,
      get matches() {
        return matchesQuery(query);
      },
      addEventListener(_type: string, listener: Listener) {
        owned.add(listener);
      },
      removeEventListener(_type: string, listener: Listener) {
        owned.delete(listener);
      },
      addListener(listener: Listener) {
        owned.add(listener);
      },
      removeListener(listener: Listener) {
        owned.delete(listener);
      },
      dispatchEvent() {
        return true;
      },
      onchange: null,
    };
  });

  return {
    setWidth(next: number) {
      width = next;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: next,
      });
      for (const [query, bucket] of listeners) {
        const event = { matches: matchesQuery(query), media: query } as MediaQueryListEvent;
        for (const listener of [...bucket]) listener(event);
      }
    },
  };
}

function listsHost() {
  const onSelectSession = vi.fn();
  const host = createMockDesktopHost({
    onSelectSession,
    issueGroups: [
      issue({
        issueId: "radii",
        title: RADII,
        priority: "p1",
        planningSessionId: "plan-radii",
      }),
      issue({
        issueId: "a11y",
        title: A11Y,
        priority: "p2",
        planningSessionId: "plan-a11y",
      }),
    ],
    closedIssueGroups: [
      issue({ issueId: "done", title: CLOSED, priority: "p0" }),
    ],
  });
  return { host, onSelectSession };
}

function ControlledLists({
  wide,
  onSelect,
}: {
  wide: boolean;
  onSelect: (panel: Exclude<PanelSelection, { kind: "none" }>) => void;
}) {
  const [menu, setMenu] = useState<"queue" | "todo" | null>(null);
  const [selected, setSelected] = useState<PanelSelection>({ kind: "none" });
  return (
    <BotLists
      wide={wide}
      menu={menu}
      selected={selected}
      queue={[
        { id: "ty", kind: "聊天", title: "回复 Ty" },
        { id: "log", kind: "自动化", title: "工作日巡检" },
      ]}
      issues={[
        { issueId: "radii", title: RADII, priority: "p1" },
        { issueId: "a11y", title: A11Y, priority: "p2" },
      ]}
      onToggleMenu={(next) => setMenu((current) => (current === next ? null : next))}
      onSelect={(panel) => {
        onSelect(panel);
        setSelected(panel);
        setMenu(null);
      }}
    />
  );
}

describe("BotLists", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows both cards when wide and selects an issue without opening a tab", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ControlledLists wide onSelect={onSelect} />);

    const lists = screen.getByTestId("bot-lists");
    expect(within(lists).getByRole("heading", { name: /待处理/ })).toBeInTheDocument();
    expect(within(lists).getByRole("heading", { name: /待办事项/ })).toBeInTheDocument();
    expect(lists).toHaveStyle({ width: "268px", alignSelf: "flex-start" });
    expect(["absolute", "fixed"]).not.toContain(getComputedStyle(lists).position);
    expect(getComputedStyle(lists).height).not.toBe("100%");

    const cards = lists.querySelectorAll(".bot-list-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const style = getComputedStyle(card);
      expect(style.borderRadius).toBe("14px");
      expect(style.boxShadow).not.toBe("none");
    }

    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: "issue", issueId: "a11y" });
    expect(within(lists).getByRole("heading", { name: /待办事项/ })).toBeInTheDocument();
    expect(within(lists).getByRole("button", { name: new RegExp(A11Y) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(document.querySelector(".bot-tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  });

  it("uses icon buttons when narrow and closes the list after a selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ControlledLists wide={false} onSelect={onSelect} />);

    expect(screen.queryByTestId("bot-lists")).toBeNull();
    expect(screen.queryByRole("heading", { name: /待办事项/ })).toBeNull();

    const pending = screen.getByRole("button", { name: "待处理" });
    const todo = screen.getByRole("button", { name: "待办" });
    expect(pending).toHaveAttribute("aria-label", "待处理");
    expect(todo).toHaveAttribute("aria-label", "待办");
    expect(pending).toHaveClass("bot-lists-tool");
    expect(todo).toHaveClass("bot-lists-tool");
    expect(pending.querySelector(".bot-lists-badge")).toHaveTextContent("2");
    expect(todo.querySelector(".bot-lists-badge")).toHaveTextContent("2");
    expect(pending.querySelector(".bot-lists-tip")).toHaveTextContent("待处理");
    expect(todo.querySelector(".bot-lists-tip")).toHaveTextContent("待办");
    expect(getComputedStyle(pending).width).toBe("32px");

    await user.click(todo);
    const row = screen.getByRole("button", { name: new RegExp(RADII) });
    expect(screen.getByTestId("bot-lists-menu")).toBeInTheDocument();
    await user.click(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: "issue", issueId: "radii" });
    expect(screen.queryByTestId("bot-lists-menu")).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(RADII) })).toBeNull();
  });
});

describe("ChatApp pending and issue lists", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWebviewStores();
  });

  it("follows the 1240px matchMedia threshold", async () => {
    expect(BOT_LISTS_WIDE_MIN_WIDTH).toBe(1240);
    resetWebviewStores();
    stubAssistant(QUEUE);
    const media = installMatchMedia();
    media.setWidth(1400);
    const { host, onSelectSession } = listsHost();
    const user = userEvent.setup();

    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={host} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const lists = await within(frame).findByTestId("bot-lists");
    expect(lists.parentElement).toHaveClass("desktop-chat-body");
    const main = frame.querySelector(".desktop-chat-main");
    expect(main).not.toBeNull();
    expect(main!.compareDocumentPosition(lists) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(lists).width).toBe("268px");
    expect(["absolute", "fixed"]).not.toContain(getComputedStyle(lists).position);
    expect(getComputedStyle(lists).alignSelf).toBe("flex-start");

    expect(await within(lists).findByText("聊天")).toBeInTheDocument();
    expect(within(lists).getByText("自动化")).toBeInTheDocument();
    expect(within(lists).getByText("权限")).toBeInTheDocument();
    const issueKind = within(lists).getByRole("button", { name: /分析 wave-agent/ });
    expect(within(issueKind).getByText("Issue")).toHaveClass("bot-list-kind");
    const untyped = within(lists).getByRole("button", { name: /没有类型的事件/ });
    expect(within(untyped).getByText("待处理")).toHaveClass("bot-list-kind");
    expect(within(lists).getByRole("button", { name: new RegExp(RADII) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(lists).queryByText(CLOSED)).toBeNull();

    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(within(lists).getByRole("heading", { name: /待办事项/ })).toBeInTheDocument();
    expect(within(lists).getByRole("button", { name: new RegExp(A11Y) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(lists).getByRole("button", { name: new RegExp(RADII) })).not.toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(frame).getAllByRole("button", { name: "Muse Bot" })).toHaveLength(1);
    expect(frame.querySelectorAll(".bot-tab")).toHaveLength(1);
    expect(within(frame).getByRole("button", { name: "Muse Bot" }).className).toContain("active");
    expect(screen.queryByTestId("desktop-panel-tab-detail")).toBeNull();

    await user.click(within(lists).getByRole("button", { name: /回复 Ty/ }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(within(lists).getByRole("button", { name: /回复 Ty/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(frame.querySelectorAll(".bot-tab")).toHaveLength(1);

    media.setWidth(1100);
    await waitFor(() => {
      expect(within(frame).queryByTestId("bot-lists")).toBeNull();
    });
    const todo = within(frame).getByRole("button", { name: "待办" });
    expect(todo).toHaveAttribute("aria-label", "待办");
    expect(todo.querySelector(".bot-lists-badge")).toHaveTextContent("2");
    expect(within(frame).getByRole("button", { name: "待处理" }).querySelector(".bot-lists-badge")).toHaveTextContent("5");

    await user.click(todo);
    const row = await within(frame).findByRole("button", { name: new RegExp(A11Y) });
    await user.click(row);
    await waitFor(() => {
      expect(within(frame).queryByRole("button", { name: new RegExp(A11Y) })).toBeNull();
    });
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(frame.querySelectorAll(".bot-tab")).toHaveLength(1);

    media.setWidth(1400);
    const wideAgain = await within(frame).findByTestId("bot-lists");
    expect(within(wideAgain).getByRole("button", { name: new RegExp(A11Y) })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("does not render lists on sessions, automations, or settings without a shell provider", async () => {
    resetWebviewStores();
    stubAssistant(QUEUE);
    const media = installMatchMedia();
    media.setWidth(1400);
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={listsHost().host} />
      </MuseTheme>,
    );

    expect(await screen.findByTestId("bot-lists")).toBeInTheDocument();

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(screen.queryByTestId("bot-lists")).toBeNull();
    expect(screen.queryByRole("button", { name: "待办" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /待办事项/ })).toBeNull();

    await user.click(screen.getByTestId("desktop-automations-menu"));
    expect(await screen.findByTestId("automations-page")).toBeInTheDocument();
    expect(screen.queryByTestId("bot-lists")).toBeNull();
    expect(screen.queryByRole("button", { name: "待办" })).toBeNull();

    await user.click(screen.getByTestId("desktop-settings-btn"));
    expect(await screen.findByTestId("desktop-settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("bot-lists")).toBeNull();
    expect(screen.queryByRole("button", { name: "待办" })).toBeNull();

    await user.click(screen.getByTestId("desktop-assistant-menu"));
    expect(await screen.findByTestId("bot-lists")).toBeInTheDocument();
  });

  it("shows the lists on the focused pane assistant frame and hides them on other surfaces", async () => {
    resetWebviewStores();
    stubAssistant(QUEUE);
    const media = installMatchMedia();
    media.setWidth(1400);
    const user = userEvent.setup();
    const { host } = listsHost();
    render(
      <MuseTheme>
        <DesktopShell
          vscode={createMockVscode()}
          host={{
            ...host,
            panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
            focusedPaneId: "pane-1",
          }}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    expect(await within(frame).findByTestId("bot-lists")).toBeInTheDocument();
    expect(within(frame).getByRole("heading", { name: /待办事项/ })).toBeInTheDocument();

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(screen.queryByTestId("bot-lists")).toBeNull();
    expect(screen.queryByRole("heading", { name: /待办事项/ })).toBeNull();

    await user.click(screen.getByTestId("desktop-automations-menu"));
    expect(screen.queryByTestId("bot-lists")).toBeNull();

    await user.click(screen.getByTestId("desktop-settings-btn"));
    expect(screen.queryByTestId("bot-lists")).toBeNull();

    await user.click(screen.getByTestId("desktop-assistant-menu"));
    expect(
      await within(await screen.findByTestId("assistant-frame")).findByTestId("bot-lists"),
    ).toBeInTheDocument();
  });

  it("shows the pending queue once beside the desktop assistant frame", async () => {
    resetWebviewStores();
    stubAssistant(QUEUE);
    const media = installMatchMedia();
    media.setWidth(1400);
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={listsHost().host} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const lists = await within(frame).findByTestId("bot-lists");
    expect(within(lists).getByRole("heading", { name: /待处理/ })).toBeInTheDocument();
    expect(within(frame).queryByRole("region", { name: "待处理队列" })).toBeNull();

    media.setWidth(1100);
    await waitFor(() => {
      expect(within(frame).getByRole("button", { name: "待处理" })).toBeInTheDocument();
    });
    expect(within(frame).queryByRole("region", { name: "待处理队列" })).toBeNull();
  });
});
