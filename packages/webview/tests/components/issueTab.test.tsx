/** @vitest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import * as botWorkspace from "../../src/components/desktop/botWorkspace";
import { MuseApiClient } from "../../src/muse/apiClient";
import { defaultDockWidth } from "../../src/muse/panelFit";
import { resetAssistantNoticeForTests } from "../../src/components/assistant/museBotNotice";
import { ASSISTANT_PANEL_GROUP_KEY, emptyFileTreeState, resetWebviewStores, usePanelGroupStore } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import type { DesktopIssueGroup, DesktopSessionEntry, FileTreeDirEntry } from "../../src/types";
import {
  createMockDesktopHost,
  createMockVscode,
  fixtures,
  sendExtensionMessage,
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

function botTab(scope: HTMLElement, name: string): HTMLElement {
  const tab = within(scope)
    .getAllByRole("button", { name })
    .find((el) => el.classList.contains("bot-tab"));
  if (!tab) throw new Error(`missing bot tab ${name}`);
  return tab;
}

const RADII = "圆角还没对齐";
const A11Y = "无障碍检查";
const EMPTY = "没有会话";
const QUEUE_TITLE = "回复 Ty";
const RADII_MESSAGE = "圆角会话正文";
const A11Y_MESSAGE = "无障碍会话正文";
const NOTES_MESSAGE = "普通会话正文";

function session(
  sessionId: string,
  workdir: string,
  title: string,
): DesktopSessionEntry {
  return {
    sessionId,
    title,
    lastActiveAt: 1,
    workdir,
    hasWorktree: false,
  };
}

function issue(
  partial: Pick<DesktopIssueGroup, "issueId" | "title" | "priority"> &
    Partial<Pick<DesktopIssueGroup, "planningSessionId" | "executionSessionId" | "sessions" | "items">>,
): DesktopIssueGroup {
  return {
    status: "planning",
    agentMode: partial.executionSessionId ? "split" : "single",
    items: partial.items ?? [],
    sessions: partial.sessions ?? [],
    ...partial,
  };
}

function textMessage(id: string, content: string) {
  return {
    id,
    role: "user" as const,
    timestamp: "2026-10-22T00:00:00.000Z",
    blocks: [{ type: "text" as const, content }],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function messageForSession(url: string) {
  if (url.includes("/sessions/plan-radii/messages")) {
    return [textMessage("radii-1", RADII_MESSAGE)];
  }
  if (url.includes("/sessions/exec-a11y/messages")) {
    return [textMessage("a11y-1", A11Y_MESSAGE)];
  }
  if (url.includes("/sessions/plan-a11y/messages")) {
    return [textMessage("a11y-plan", "规划不该被读到")];
  }
  return [];
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
      if (url.includes("/sessions/") && url.includes("/messages")) {
        return jsonResponse({ messages: messageForSession(url), hasMore: false });
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

const RADII_ISSUE = issue({
  issueId: "radii",
  title: RADII,
  priority: "p1",
  planningSessionId: "plan-radii",
  sessions: [session("plan-radii", "/work/radii", RADII)],
  items: [{ id: "measure", content: "量一下圆角", status: "pending" }],
});

const A11Y_ISSUE = issue({
  issueId: "a11y",
  title: A11Y,
  priority: "p2",
  planningSessionId: "plan-a11y",
  executionSessionId: "exec-a11y",
  sessions: [
    session("plan-a11y", "/work/a11y-plan", "规划"),
    session("exec-a11y", "/work/a11y-exec", "执行"),
  ],
  items: [{ id: "focus", content: "补上焦点环", status: "pending" }],
});

function seedFileGroup(key: string) {
  usePanelGroupStore.getState().patchGroup(key, {
    checked: ["file", "terminal", "preview", "diff"],
    mounted: ["file", "terminal", "preview", "diff"],
    active: "file",
    fileTree: { ...emptyFileTreeState(), collapsed: false },
  });
}

function dirEntry(
  name: string,
  workdir: string,
  relativePath: string,
  isDirectory: boolean,
): FileTreeDirEntry {
  const path = relativePath ? `${workdir}/${relativePath}` : workdir;
  return { name, path, relativePath, isDirectory };
}

function listDirMessages(vscode: ReturnType<typeof createMockVscode>) {
  return vscode.postMessage.mock.calls
    .map((call) => call[0] as { command?: string; dir?: string; workdir?: string })
    .filter((message) => message.command === "desktopListDir");
}

function replyListDir(dir: string, entries: FileTreeDirEntry[]) {
  sendExtensionMessage({ command: "desktopListDirResult", dir, entries });
}

async function withElementBox<T>(run: () => Promise<T>): Promise<T> {
  const proto = HTMLElement.prototype;
  const height = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const width = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get: () => 300,
  });
  try {
    return await run();
  } finally {
    if (height) Object.defineProperty(proto, "offsetHeight", height);
    if (width) Object.defineProperty(proto, "offsetWidth", width);
  }
}

describe("issue tab", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetWebviewStores();
    resetAssistantNoticeForTests();
    delete (HTMLElement.prototype as { loadURL?: unknown }).loadURL;
  });

  it("opens the issue transcript from detail without leaving Muse Bot", async () => {
    resetWebviewStores();
    const fetched: string[] = [];
    stubAssistant(fetched);
    stubWideViewport();
    seedFileGroup("/work/radii");
    seedFileGroup("/work/notes");
    const onSelectSession = vi.fn();
    const host = createMockDesktopHost({
      onSelectSession,
      issueGroups: [RADII_ISSUE, A11Y_ISSUE],
      sessionTree: [
        {
          host: "local",
          workdir: "recent",
          sessions: [session("sess-notes", "/work/notes", "会议记录")],
        },
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
    await user.click(within(dock).getByRole("button", { name: "文件" }));
    const tree = await within(dock).findByTestId("file-tree-workdir");
    expect(tree).toHaveTextContent("radii");
    expect(tree).toHaveAttribute("title", "/work/radii");

    fireEvent.click(within(dock).getByRole("button", { name: "打开会话", hidden: true }));

    expect(onSelectSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");
    expect(within(dock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(botTab(frame, RADII)).toHaveClass("active");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect((await within(frame).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);
    expect(fetched.some((url) => url.includes("/sessions/plan-radii/messages"))).toBe(true);
    expect(fetched.some((url) => url.includes("/sessions/exec-a11y/messages"))).toBe(false);
    expect(screen.queryByText("今天想让我帮你做些什么？")).toBeNull();
    expect(within(frame).queryByTestId("bot-lists")).toBeNull();
    expect(within(frame).queryByRole("button", { name: "待处理" })).toBeNull();
    expect(within(frame).getByRole("button", { name: "事项" })).toBeInTheDocument();

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(within(frame).queryByTestId("issue-session-title")).toBeNull();
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();

    await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
    expect(within(dock).getByRole("button", { name: "切到会话" })).toBeInTheDocument();
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "打开会话" })).toBeInTheDocument();

    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(botTab(frame, A11Y)).toHaveClass("active");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(A11Y);
    expect((await within(frame).findAllByText(A11Y_MESSAGE)).length).toBeGreaterThan(0);
    expect(within(frame).queryByTestId("input-workdir-row")).toBeNull();
    expect(within(frame).queryByText("选择工作目录…")).toBeNull();
    expect(within(frame).queryByText("默认权限")).toBeNull();
    expect(fetched.some((url) => url.includes("/sessions/exec-a11y/messages"))).toBe(true);
    expect(within(frame).queryByText("规划不该被读到")).toBeNull();
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();

    await user.click(botTab(frame, RADII));
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(within(dock).getByRole("heading", { name: RADII })).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "切到会话" })).toBeNull();
    await user.click(botTab(frame, A11Y));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(botTab(frame, A11Y)).toHaveClass("active");
    expect(botTab(frame, RADII)).not.toHaveClass("active");
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "切到会话" })).toBeNull();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    await user.click(within(frame).getByRole("button", { name: new RegExp(QUEUE_TITLE) }));
    expect(within(dock).getByRole("heading", { name: QUEUE_TITLE })).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(within(dock).queryByRole("button", { name: "文件" })).toBeNull();
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-file"));
    const expandQueued = within(dock).getByTestId("file-tree-expand-btn");
    if (expandQueued.getAttribute("aria-pressed") !== "true") {
      await user.click(expandQueued);
    }
    const queuedTree = await within(dock).findByTestId("file-tree-workdir");
    expect(queuedTree).toHaveTextContent("a11y-exec");
    expect(queuedTree).toHaveAttribute("title", "/work/a11y-exec");
    expect(queuedTree).not.toHaveTextContent("proj");

    await user.click(botTab(frame, RADII));
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(screen.queryByTestId("bot-lists")).toBeNull();
    expect(document.querySelector(".bot-tabs")).toBeNull();
    expect(screen.queryByRole("heading", { name: /待办事项/ })).toBeNull();
    const notes = await screen.findByTestId("desktop-session-item-sess-notes");
    await user.click(notes);
    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("/work/notes", "sess-notes");
    sendHostMessage(
      fixtures.setInitialState({
        workdir: "/work/notes",
        messages: [textMessage("notes-1", NOTES_MESSAGE)],
        isAuthenticated: true,
        session: {
          id: "sess-notes",
          sessionType: "main",
          workdir: "/work/notes",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );
    const chat = await screen.findByTestId("chat-container");
    expect(within(chat).getAllByText(NOTES_MESSAGE).length).toBeGreaterThan(0);
    expect(within(chat).queryByTestId("issue-session-header")).toBeNull();
    expect(screen.getByTestId("desktop-session-item-sess-notes").className).toContain(
      "desktop-session-item--current",
    );
    const sessionDock = await within(chat).findByTestId("desktop-panel-dock");
    await user.click(within(sessionDock).getByRole("button", { name: "文件" }));
    const sessionTree = await within(sessionDock).findByTestId("file-tree-workdir");
    expect(sessionTree).toHaveAttribute("title", "/work/radii");
    expect(sessionTree).not.toHaveTextContent("notes");

    const callsAfterSession = onSelectSession.mock.calls.length;
    await user.click(screen.getByTestId("desktop-assistant-menu"));
    const back = await screen.findByTestId("assistant-frame");
    expect(botTab(back, RADII)).toHaveClass("active");
    expect(within(back).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(screen.getByTestId("desktop-session-item-sess-notes").className).toContain(
      "desktop-session-item--current",
    );
    expect(screen.queryByTestId("desktop-session-item-plan-radii")).toBeNull();
    expect(screen.queryByTestId("desktop-session-item-exec-a11y")).toBeNull();
    expect(onSelectSession).toHaveBeenCalledTimes(callsAfterSession);
  });

  it("hides the detail button when the issue has no session id", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [
              issue({
                issueId: "empty",
                title: EMPTY,
                priority: "p2",
                sessions: [],
              }),
            ],
          })}
        />
      </MuseTheme>,
    );

    const user = userEvent.setup();
    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(await within(dock).findByRole("heading", { name: EMPTY })).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(within(dock).queryByRole("button", { name: "切到会话" })).toBeNull();
  });

  it("keeps the open issue transcript when leaving Muse Bot and coming back", async () => {
    resetWebviewStores();
    const fetched: string[] = [];
    stubAssistant(fetched);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect((await within(frame).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(document.querySelector(".bot-tabs")).toBeNull();
    await user.click(screen.getByTestId("desktop-automations-menu"));
    expect(await screen.findByTestId("automations-page")).toBeInTheDocument();
    await user.click(screen.getByTestId("desktop-settings-btn"));
    expect(await screen.findByTestId("desktop-settings-page")).toBeInTheDocument();
    await user.click(screen.getByTestId("desktop-assistant-menu"));

    const back = await screen.findByTestId("assistant-frame");
    expect(botTab(back, RADII)).toHaveClass("active");
    expect(within(back).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(within(back).getAllByText(RADII_MESSAGE).length).toBeGreaterThan(0);
    expect(within(back).queryByText("今天想让我帮你做些什么？")).toBeNull();
  });

  it("scrolls the issue transcript clear of the icon rail", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect((await within(frame).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);

    const transcript = within(frame).getByTestId("issue-tab-transcript");
    expect(transcript).toHaveClass("issue-tab-transcript");
    expect(transcript.querySelector(".messages-container")).not.toBeNull();

    const css = fs.readFileSync(
      path.join(__dirname, "../../src/styles/DesktopApp.css"),
      "utf8",
    );
    const bodies = (className: string) =>
      (css.match(/[^{}]+\{[^}]*\}/g) ?? [])
        .filter((block) => block.split("{")[0]?.includes(`.${className}`))
        .map((block) => block.split("{")[1] ?? "")
        .join("\n");

    const transcriptCss = bodies("issue-tab-transcript");
    expect(transcriptCss).toMatch(/flex:\s*1\b/);
    expect(transcriptCss).toMatch(/min-height:\s*0/);
    expect(transcriptCss).toMatch(/overflow:\s*hidden/);

    const messagesCss = bodies("messages-container");
    expect(messagesCss).toMatch(
      /padding-left:\s*calc\(\s*var\(--desktop-sidebar-width\)\s*\+\s*var\(--space-4\)\s*\)/,
    );
  });

  it("shows the issue transcript in the focused pane only", async () => {
    resetWebviewStores();
    const fetched: string[] = [];
    stubAssistant(fetched);
    stubWideViewport();
    const onSelectSession = vi.fn();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            onSelectSession,
            panes: [
              { paneId: "pane-a", sessionId: "sess-a" },
              { paneId: "pane-b", sessionId: "sess-b" },
            ],
            focusedPaneId: "pane-a",
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const paneA = await screen.findByTestId("desktop-pane-pane-a");
    const paneB = await screen.findByTestId("desktop-pane-pane-b");
    const dock = await ensureAssistantDock(paneA, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));

    expect(onSelectSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");
    expect(within(paneA).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect((await within(paneA).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);
    expect(within(paneB).queryByTestId("issue-session-header")).toBeNull();
    expect(fetched.some((url) => url.includes("/sessions/plan-radii/messages"))).toBe(true);

    await user.click(screen.getByTestId("desktop-automations-menu"));
    await user.click(screen.getByTestId("desktop-settings-btn"));
    await user.click(screen.getByTestId("desktop-assistant-menu"));
    const paneAgain = await screen.findByTestId("desktop-pane-pane-a");
    expect(botTab(paneAgain, RADII)).toHaveClass("active");
    expect(within(paneAgain).getByTestId("issue-session-title")).toHaveTextContent(RADII);
  });

  it("does not apply an expanded directory from the previous issue", async () => {
    await withElementBox(async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    seedFileGroup("/work/radii");
    const vscode = createMockVscode();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "文件" }));
    replyListDir("", [dirEntry("src", "/work/radii", "src", true)]);
    const src = await within(dock).findByTestId("file-tree-row-src");
    await user.click(src);
    await waitFor(() => {
      expect(listDirMessages(vscode)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dir: "src", workdir: "/work/radii" }),
        ]),
      );
    });
    replyListDir("src", [dirEntry("old-child.ts", "/work/radii", "src/old-child.ts", false)]);
    expect(await within(dock).findByTestId("file-tree-row-src/old-child.ts")).toBeInTheDocument();

    vscode.postMessage.mockClear();
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));

    expect(within(dock).queryByRole("button", { name: "文件" })).toBeNull();
    expect(within(dock).queryByTestId("file-tree-row-src/old-child.ts")).toBeNull();
    expect(within(dock).queryByText("old-child.ts")).toBeNull();
    expect(
      usePanelGroupStore.getState().groups["/work/radii"]?.fileTree.expanded ?? [],
    ).toContain("src");
    expect(
      usePanelGroupStore.getState().groups["/work/a11y-exec"]?.fileTree?.expanded ?? [],
    ).not.toContain("src");
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-file"));
    const expandNext = within(dock).getByTestId("file-tree-expand-btn");
    if (expandNext.getAttribute("aria-pressed") !== "true") {
      await user.click(expandNext);
    }
    await waitFor(() => {
      expect(listDirMessages(vscode)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dir: "", workdir: "/work/a11y-exec" }),
        ]),
      );
    });
    expect(
      listDirMessages(vscode).some(
        (message) => message.dir === "src" && message.workdir === "/work/a11y-exec",
      ),
    ).toBe(false);
    });
  });

  it("shows the next issue directory on 会话 without the previous expansion", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      seedFileGroup("/work/radii");
      seedFileGroup("/work/notes");
      const vscode = createMockVscode();
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={vscode}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE, A11Y_ISSUE],
              sessionTree: [
                {
                  host: "local",
                  workdir: "recent",
                  sessions: [session("sess-notes", "/work/notes", "会议记录")],
                },
              ],
            })}
          />
        </MuseTheme>,
      );

      sendHostMessage(
        fixtures.setInitialState({
          workdir: "/work/notes",
          messages: [textMessage("notes-1", NOTES_MESSAGE)],
          isAuthenticated: true,
          session: {
            id: "sess-notes",
            sessionType: "main",
            workdir: "/work/notes",
            createdAt: new Date(),
            lastActiveAt: new Date(),
            latestTotalTokens: 0,
          },
        }),
      );
      await user.click(screen.getByTestId("desktop-sessions-menu"));
      const chat = await screen.findByTestId("chat-container");
      const dock = await within(chat).findByTestId("desktop-panel-dock");
      await user.click(within(dock).getByRole("button", { name: "文件" }));
      const tree = await within(dock).findByTestId("file-tree-workdir");
      expect(tree).toHaveAttribute("title", "/work/radii");
      replyListDir("", [dirEntry("src", "/work/radii", "src", true)]);
      const src = await within(dock).findByTestId("file-tree-row-src");
      await user.click(src);
      await waitFor(() => {
        expect(listDirMessages(vscode)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ dir: "src", workdir: "/work/radii" }),
          ]),
        );
      });
      replyListDir("src", [
        dirEntry("old-child.ts", "/work/radii", "src/old-child.ts", false),
      ]);
      expect(
        await within(dock).findByTestId("file-tree-row-src/old-child.ts"),
      ).toBeInTheDocument();

      vscode.postMessage.mockClear();
      await user.click(screen.getByTestId("desktop-assistant-menu"));
      const frame = await screen.findByTestId("assistant-frame");
      const lists = within(frame).getByTestId("bot-lists");
      await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
      await user.click(screen.getByTestId("desktop-sessions-menu"));

      const chatAgain = await screen.findByTestId("chat-container");
      expect(within(chatAgain).queryByRole("button", { name: "文件" })).toBeNull();
      await user.click(within(chatAgain).getByTestId("panel-toggle-btn"));
      const dockAgain = await within(chatAgain).findByTestId("desktop-panel-dock");
      await user.click(within(dockAgain).getByTestId("desktop-panel-add-btn"));
      await user.click(await screen.findByTestId("panel-add-item-file"));
      const expandNext = within(dockAgain).getByTestId("file-tree-expand-btn");
      if (expandNext.getAttribute("aria-pressed") !== "true") {
        await user.click(expandNext);
      }
      const nextTree = await within(dockAgain).findByTestId("file-tree-workdir");
      expect(nextTree).toHaveAttribute("title", "/work/a11y-exec");
      await waitFor(() => {
        expect(listDirMessages(vscode)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ dir: "", workdir: "/work/a11y-exec" }),
          ]),
        );
      });
      expect(
        listDirMessages(vscode).some(
          (message) => message.dir === "src" && message.workdir === "/work/a11y-exec",
        ),
      ).toBe(false);
      expect(within(dockAgain).queryByTestId("file-tree-row-src/old-child.ts")).toBeNull();
      expect(within(dockAgain).queryByText("old-child.ts")).toBeNull();
      expect(
        usePanelGroupStore.getState().groups["/work/radii"]?.fileTree.expanded ?? [],
      ).toContain("src");
    });
  });

  it("requests the selected issue directory when 变更 opens on Muse Bot", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const vscode = createMockVscode();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    await user.click(within(frame).getByTestId("panel-toggle-btn"));
    expect(within(frame).getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(frame).getByTestId("desktop-panel-tab-diff")).toBeInTheDocument();

    await waitFor(() => {
      const diffCalls = vscode.postMessage.mock.calls
        .map((call) => call[0] as { command?: string; workdir?: string; baseBranch?: string })
        .filter(
          (message) =>
            message.command === "desktopGetWorkspaceDiff" ||
            message.command === "desktopGetBranchDiff",
        );
      expect(diffCalls.length).toBeGreaterThan(0);
      expect(diffCalls.every((message) => message.command === "desktopGetWorkspaceDiff")).toBe(true);
      expect(diffCalls.every((message) => message.workdir === "/work/radii")).toBe(true);
      expect(diffCalls.every((message) => message.baseBranch === undefined)).toBe(true);
    });
  });

  it("keeps browser tabs across issues and can open another", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["preview"],
      mounted: ["preview"],
      active: "preview",
      previewUrl: null,
    });
    const user = userEvent.setup();
    Object.defineProperty(HTMLElement.prototype, "loadURL", {
      configurable: true,
      value: () => undefined,
    });
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-preview"));
    const address = within(dock).getByTestId("preview-address");
    await user.click(address);
    await user.type(address, "http://radii.test");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(address).toHaveValue("http://radii.test/");
    });
    const previewUrls = () =>
      (usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [])
        .filter((tool) => tool.kind === "preview")
        .map((tool) => tool.previewUrl);
    expect(previewUrls()).toEqual(["http://radii.test/"]);
    expect(usePanelGroupStore.getState().groups["/work/radii"]?.previewUrl ?? null).toBeNull();

    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(dock.querySelector('[title="http://radii.test/"]')).toBeTruthy();
    expect(previewUrls()).toEqual(["http://radii.test/"]);
    expect(usePanelGroupStore.getState().groups["/work/a11y-exec"]?.previewUrl ?? null).toBeNull();

    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-preview"));
    const nextAddress = within(dock).getByTestId("preview-address");
    await user.click(nextAddress);
    await user.type(nextAddress, "http://a11y.test");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(nextAddress).toHaveValue("http://a11y.test/");
    });
    expect(previewUrls()).toEqual(["http://radii.test/", "http://a11y.test/"]);
    expect(dock.querySelector('[title="http://radii.test/"]')).toBeTruthy();
    expect(dock.querySelector('[title="http://a11y.test/"]')).toBeTruthy();
    expect(usePanelGroupStore.getState().groups["/work/radii"]?.previewUrl ?? null).toBeNull();
    expect(usePanelGroupStore.getState().groups["/work/a11y-exec"]?.previewUrl ?? null).toBeNull();
  });

  it("opens each terminal in the current issue workdir and keeps them when the issue changes", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    const terminalWorkdirs = () =>
      (usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [])
        .filter((tool) => tool.kind === "terminal")
        .map((tool) => tool.workdir);

    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-terminal"));
    expect(terminalWorkdirs()).toEqual(["/work/radii"]);
    expect(dock.querySelector('[title="/work/radii"]')).toBeTruthy();

    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(terminalWorkdirs()).toEqual(["/work/radii"]);
    expect(dock.querySelector('[title="/work/radii"]')).toBeTruthy();

    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-terminal"));
    expect(terminalWorkdirs()).toEqual(["/work/radii", "/work/a11y-exec"]);
    expect(dock.querySelector('[title="/work/radii"]')).toBeTruthy();
    expect(dock.querySelector('[title="/work/a11y-exec"]')).toBeTruthy();
  });

  it("uses the normal session directory on 会话 when no issue is selected", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    seedFileGroup(ASSISTANT_PANEL_GROUP_KEY);
    seedFileGroup("/work/notes");
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [],
            sessionTree: [
              {
                host: "local",
                workdir: "/work/notes",
                sessions: [session("sess-notes", "/work/notes", "会议记录")],
              },
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const assistantDock = await ensureAssistantDock(frame, user);
    await user.click(within(assistantDock).getByRole("button", { name: "文件" }));
    await waitFor(() => {
      expect(within(assistantDock).getByTestId("file-tree-workdir")).toHaveAttribute(
        "title",
        "/tmp/proj",
      );
    });

    sendHostMessage(
      fixtures.setInitialState({
        workdir: "/work/notes",
        messages: [textMessage("notes-1", NOTES_MESSAGE)],
        isAuthenticated: true,
        session: {
          id: "sess-notes",
          sessionType: "main",
          workdir: "/work/notes",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    const chat = await screen.findByTestId("chat-container");
    const dock = await within(chat).findByTestId("desktop-panel-dock");
    const fileTab = within(dock).getByRole("button", { name: "文件" });
    if (!fileTab.className.includes("desktop-panel-tab--active")) {
      await user.click(fileTab);
    }
    const tree = await within(dock).findByTestId("file-tree-workdir");
    expect(tree).toHaveAttribute("title", "/work/notes");
    expect(tree).not.toHaveAttribute("title", "/tmp/proj");
  });

  it("drops a content-search response from the previous issue after switching", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      seedFileGroup("/work/radii");
      const vscode = createMockVscode();
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={vscode}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE, A11Y_ISSUE],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "文件" }));
      replyListDir("", [dirEntry("src", "/work/radii", "src", true)]);
      await user.click(within(dock).getByTestId("file-sidebar-mode-search"));
      const input = await within(dock).findByTestId("content-search-input");

      vi.useFakeTimers();
      try {
        fireEvent.change(input, { target: { value: "round" } });
        fireEvent.click(
          within(frame).getByRole("button", { name: new RegExp(A11Y) }),
        );
        await act(async () => {
          vi.advanceTimersByTime(300);
        });
      } finally {
        vi.useRealTimers();
      }

      const searchCalls = vscode.postMessage.mock.calls
        .map((call) => call[0] as { command?: string; requestId?: string; workdir?: string })
        .filter((message) => message.command === "desktopSearchContent");
      const stale = searchCalls.find((message) => message.workdir === "/work/radii");
      sendExtensionMessage({
        command: "desktopSearchContentResult",
        requestId: stale?.requestId ?? "cs-stale",
        results: [
          {
            path: "/work/radii/old-hit.ts",
            relativePath: "old-hit.ts",
            matches: [
              { line: 1, text: "previous-issue-hit", startCol: 0, endCol: 4 },
            ],
          },
        ],
      });

      expect(within(dock).queryByTestId("file-sidebar-mode-search")).toBeNull();
      expect(within(dock).queryByText("previous-issue-hit")).toBeNull();
      expect(within(dock).queryByTestId("content-search-file-old-hit.ts")).toBeNull();
      expect(
        usePanelGroupStore.getState().groups["/work/a11y-exec"]?.contentSearch?.results ?? [],
      ).toEqual([]);
    });
  });

  it("keeps an in-flight directory listing on the issue that requested it", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      seedFileGroup("/work/radii");
      const vscode = createMockVscode();
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={vscode}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE, A11Y_ISSUE],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "文件" }));
      replyListDir("", [dirEntry("src", "/work/radii", "src", true)]);
      const src = await within(dock).findByTestId("file-tree-row-src");
      await user.click(src);
      await waitFor(() => {
        expect(listDirMessages(vscode)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ dir: "src", workdir: "/work/radii" }),
          ]),
        );
      });
      const staleSrc = vscode.postMessage.mock.calls
        .map((call) => call[0] as { command?: string; dir?: string; workdir?: string; requestId?: string })
        .find(
          (message) =>
            message.command === "desktopListDir" &&
            message.dir === "src" &&
            message.workdir === "/work/radii",
        );

      vscode.postMessage.mockClear();
      const lists = within(frame).getByTestId("bot-lists");
      await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));

      expect(within(dock).queryByRole("button", { name: "文件" })).toBeNull();
      expect(
        listDirMessages(vscode).some(
          (message) => message.dir === "src" && message.workdir === "/work/a11y-exec",
        ),
      ).toBe(false);

      sendExtensionMessage({
        command: "desktopListDirResult",
        requestId: staleSrc?.requestId,
        dir: "src",
        entries: [dirEntry("old-child.ts", "/work/radii", "src/old-child.ts", false)],
      });
      expect(within(dock).queryByTestId("file-tree-row-src/old-child.ts")).toBeNull();
      expect(within(dock).queryByText("old-child.ts")).toBeNull();
      expect(
        usePanelGroupStore.getState().groups["/work/radii"]?.fileTree.childrenCache.src?.some(
          (entry) => entry.name === "old-child.ts",
        ),
      ).toBe(true);
      expect(
        usePanelGroupStore.getState().groups["/work/a11y-exec"]?.fileTree?.childrenCache?.src,
      ).toBeUndefined();
    });
  });

  it("keeps the issue diff when another normal session is selected on 会话", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["diff"],
      mounted: ["diff"],
      active: "diff",
    });
    usePanelGroupStore.getState().patchGroup("/work/notes", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
    });
    const vscode = createMockVscode();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
            sessionTree: [
              {
                host: "local",
                workdir: "recent",
                sessions: [
                  session("sess-notes", "/work/notes", "会议记录"),
                  session("sess-other", "/work/notes", "另一条"),
                ],
              },
            ],
          })}
        />
      </MuseTheme>,
    );

    sendHostMessage(
      fixtures.setInitialState({
        workdir: "/work/notes",
        messages: [textMessage("notes-1", NOTES_MESSAGE)],
        isAuthenticated: true,
        session: {
          id: "sess-notes",
          sessionType: "main",
          workdir: "/work/notes",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    const chat = await screen.findByTestId("chat-container");
    const dock = await within(chat).findByTestId("desktop-panel-dock");
    await user.click(within(dock).getByRole("button", { name: "变更" }));

    await waitFor(() => {
      const diffCalls = vscode.postMessage.mock.calls
        .map((call) => call[0] as { command?: string; workdir?: string })
        .filter((message) => message.command === "desktopGetWorkspaceDiff");
      expect(diffCalls.some((message) => message.workdir === "/work/radii")).toBe(true);
    });
    const request = vscode.postMessage.mock.calls
      .map((call) => call[0] as { command?: string; workdir?: string; requestId?: string })
      .find(
        (message) =>
          message.command === "desktopGetWorkspaceDiff" && message.workdir === "/work/radii",
      );
    sendExtensionMessage({
      command: "desktopWorkspaceDiff",
      requestId: request?.requestId,
      result: {
        kind: "ok",
        files: [
          {
            path: "issue-keep.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            hunks: "@@ -0,0 +1 @@\n+keep",
            truncated: false,
            binary: false,
          },
        ],
      },
    });
    expect(await within(dock).findByText("issue-keep.ts")).toBeInTheDocument();

    await user.click(screen.getByTestId("desktop-session-item-sess-other"));
    sendExtensionMessage({
      command: "updateCurrentSession",
      session: {
        id: "sess-other",
        sessionType: "main",
        workdir: "/work/notes",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    await waitFor(() => {
      expect(within(dock).getByTestId("diff-commit")).toBeInTheDocument();
    });
    expect(within(dock).getByText("issue-keep.ts")).toBeInTheDocument();
    expect(within(dock).queryByText("无改动")).toBeNull();
    const diffCalls = vscode.postMessage.mock.calls
      .map((call) => call[0] as { command?: string; workdir?: string })
      .filter(
        (message) =>
          message.command === "desktopGetWorkspaceDiff" ||
          message.command === "desktopGetBranchDiff",
      );
    expect(diffCalls.every((message) => message.command === "desktopGetWorkspaceDiff")).toBe(true);
    expect(diffCalls.every((message) => message.workdir === "/work/radii")).toBe(true);
    expect(diffCalls.some((message) => message.workdir === "/work/notes")).toBe(false);
  });

  it("shows a failed issue transcript instead of an empty one and retries the load", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    let radiiLoads = 0;
    const getMessages = vi
      .spyOn(MuseApiClient.prototype, "getMessages")
      .mockImplementation(async (id) => {
        if (id !== "plan-radii") return { messages: [], hasMore: false };
        radiiLoads += 1;
        if (radiiLoads === 1) throw new Error("messages unavailable");
        return {
          messages: [textMessage("radii-1", RADII_MESSAGE)],
          hasMore: false,
        };
      });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [
              RADII_ISSUE,
              issue({
                issueId: "empty",
                title: EMPTY,
                priority: "p2",
                planningSessionId: "plan-empty",
                sessions: [session("plan-empty", "/work/empty", EMPTY)],
              }),
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));

    const transcript = within(frame).getByTestId("issue-tab-transcript");
    expect(await within(transcript).findByText("会话加载失败")).toBeInTheDocument();
    expect(within(transcript).queryByText(RADII_MESSAGE)).toBeNull();
    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(getMessages).toHaveBeenCalledWith("plan-radii");

    await user.click(within(transcript).getByRole("button", { name: "重试" }));

    expect((await within(transcript).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);
    expect(within(transcript).queryByText("会话加载失败")).toBeNull();
    expect(within(transcript).queryByRole("button", { name: "重试" })).toBeNull();
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(getMessages.mock.calls.filter((call) => call[0] === "plan-radii")).toHaveLength(2);

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(EMPTY) }));
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    await waitFor(() => {
      expect(getMessages).toHaveBeenCalledWith("plan-empty");
    });
    const emptyTranscript = within(frame).getByTestId("issue-tab-transcript");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(EMPTY);
    expect(within(emptyTranscript).queryByText("会话加载失败")).toBeNull();
    expect(within(emptyTranscript).queryByRole("button", { name: "重试" })).toBeNull();
    expect(await within(emptyTranscript).findByTestId("welcome-headline")).toBeInTheDocument();
    expect(emptyTranscript.querySelector(".messages-container")).toBeNull();
  });

  it("keeps a bot file preview across issues, and a list click stays on 详情", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      seedFileGroup("/work/radii");
      const selectDock = vi.spyOn(botWorkspace, "selectDock");
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={createMockVscode()}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE, A11Y_ISSUE],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "文件" }));
      replyListDir("", [
        dirEntry("src", "/work/radii", "src", true),
        dirEntry("App.tsx", "/work/radii", "App.tsx", false),
      ]);
      await user.click(await within(dock).findByTestId("file-tree-row-src"));
      replyListDir("src", [
        dirEntry("old-child.ts", "/work/radii", "src/old-child.ts", false),
      ]);
      expect(
        await within(dock).findByTestId("file-tree-row-src/old-child.ts"),
      ).toBeInTheDocument();
      await user.click(within(dock).getByTestId("file-tree-row-App.tsx"));
      const radiiTab = await within(dock).findByTestId("file-tab");
      expect(radiiTab).toHaveAttribute("data-path", "/work/radii/App.tsx");
      expect(radiiTab).toHaveAttribute("data-active", "true");
      expect(within(dock).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
        "desktop-panel-tab--active",
      );

      selectDock.mockClear();
      const lists = within(frame).getByTestId("bot-lists");
      await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));

      expect(selectDock).not.toHaveBeenCalled();
      expect(within(dock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
        "desktop-panel-tab--active",
      );
      const stayed = within(dock).getByTestId("file-tab");
      expect(stayed).toHaveAttribute("data-path", "/work/radii/App.tsx");
      expect(stayed).toHaveAttribute("data-active", "false");
      expect(within(dock).queryByTestId("file-tree-row-src/old-child.ts")).toBeNull();
      expect(usePanelGroupStore.getState().groups["/work/radii"]?.active).toBe("file");
      expect(
        usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs?.map(
          (tab) => tab.path,
        ),
      ).toEqual(["/work/radii/App.tsx"]);
      expect(
        usePanelGroupStore.getState().groups["/work/radii"]?.fileTabs ?? [],
      ).toEqual([]);
      expect(
        usePanelGroupStore.getState().groups["/work/a11y-exec"]?.checked ?? [],
      ).not.toContain("file");
      expect(
        usePanelGroupStore.getState().groups["/work/radii"]?.fileTree.expanded ?? [],
      ).toContain("src");
      expect(
        usePanelGroupStore.getState().groups["/work/a11y-exec"]?.fileTree?.expanded ?? [],
      ).not.toContain("src");

      await user.click(within(dock).getByTestId("file-tab"));
      const expandA11y = within(dock).getByTestId("file-tree-expand-btn");
      if (expandA11y.getAttribute("aria-pressed") !== "true") {
        await user.click(expandA11y);
      }
      expect(within(dock).getByTestId("file-tree-workdir")).toHaveAttribute(
        "title",
        "/work/a11y-exec",
      );
      expect(within(dock).getByTestId("file-tab")).toHaveAttribute(
        "data-path",
        "/work/radii/App.tsx",
      );
      expect(within(dock).queryByText("old-child.ts")).toBeNull();

      selectDock.mockClear();
      await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
      expect(selectDock).not.toHaveBeenCalled();
      expect(within(dock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
        "desktop-panel-tab--active",
      );

      const restored = within(dock).getByTestId("file-tab");
      expect(restored).toHaveAttribute("data-path", "/work/radii/App.tsx");
      expect(restored).toHaveAttribute("data-active", "false");
      await user.click(restored);
      expect(within(dock).getByTestId("file-tab")).toHaveAttribute("data-active", "true");
      expect(within(dock).getByTestId("file-tree-workdir")).toHaveAttribute(
        "title",
        "/work/radii",
      );
      expect(
        await within(dock).findByTestId("file-tree-row-src/old-child.ts"),
      ).toBeInTheDocument();
    });
  });

  it("shares the file tab when two issues use the same directory", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      seedFileGroup("/work/radii");
      const shared = issue({
        issueId: "shared-b",
        title: "同一目录",
        priority: "p2",
        planningSessionId: "plan-shared-b",
        sessions: [session("plan-shared-b", "/work/radii", "同一目录")],
      });
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={createMockVscode()}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE, shared],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "文件" }));
      replyListDir("", [dirEntry("App.tsx", "/work/radii", "App.tsx", false)]);
      await user.click(await within(dock).findByTestId("file-tree-row-App.tsx"));
      expect(await within(dock).findByTestId("file-tab")).toHaveAttribute(
        "data-path",
        "/work/radii/App.tsx",
      );

      const lists = within(frame).getByTestId("bot-lists");
      await user.click(within(lists).getByRole("button", { name: /同一目录/ }));

      expect(within(dock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
        "desktop-panel-tab--active",
      );
      const sharedTab = within(dock).getByTestId("file-tab");
      expect(sharedTab).toHaveAttribute("data-path", "/work/radii/App.tsx");
      expect(sharedTab).toHaveAttribute("data-active", "false");
    });
  });

  it("opens 详情 at the same width the first tool tab would use", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    Object.defineProperty(frame, "clientWidth", {
      configurable: true,
      value: 1400,
    });
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
    const dock = await ensureAssistantDock(frame, user);
    const width = `${defaultDockWidth(1400)}px`;
    expect(dock).toHaveStyle({ "--dock-width": width });

    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-file"));
    expect(within(frame).getByTestId("desktop-panel-dock")).toHaveStyle({
      "--dock-width": width,
    });
  });

  it("keeps a resized 详情 column when another tab opens", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    Object.defineProperty(frame, "clientWidth", {
      configurable: true,
      value: 1800,
    });
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
    const dock = await ensureAssistantDock(frame, user);
    const resized = { preview: 640, diff: 640, terminal: 640, file: 640 };
    act(() => {
      usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        widths: resized,
      });
    });
    expect(dock).toHaveStyle({ "--dock-width": "640px" });

    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-file"));
    expect(within(frame).getByTestId("desktop-panel-dock")).toHaveStyle({
      "--dock-width": "640px",
    });
  });

  it("keeps the Muse Bot dock width when switching issues", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const wide = { preview: 640, diff: 640, terminal: 640, file: 640 };
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      widths: wide,
      dockColumnOpen: true,
    });
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
      widths: { preview: 360, diff: 360, terminal: 360, file: 360 },
    });
    usePanelGroupStore.getState().patchGroup("/work/a11y-exec", {
      checked: ["terminal"],
      mounted: ["terminal"],
      active: "terminal",
      widths: { preview: 500, diff: 500, terminal: 500, file: 500 },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(dock).toHaveStyle({ "--dock-width": "640px" });

    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(within(frame).getByTestId("desktop-panel-dock")).toHaveStyle({
      "--dock-width": "640px",
    });
    expect(usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.widths).toEqual(
      wide,
    );
  });

  it("stores a file-content reply on the selected issue", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    await screen.findByTestId("assistant-frame");
    sendExtensionMessage({
      command: "desktopFileContent",
      fileView: {
        path: "/work/radii/App.tsx",
        host: "local",
        content: "export {}\n",
      },
    });

    expect(
      usePanelGroupStore.getState().groups["/work/radii"]?.fileTabs?.map((tab) => tab.path),
    ).toEqual(["/work/radii/App.tsx"]);
    expect(
      usePanelGroupStore.getState().groups["/work/radii"]?.activeFilePath,
    ).toBe("/work/radii/App.tsx");
  });

  it("closes the last file tab and leaves the directory's other kinds", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      usePanelGroupStore.getState().patchGroup("/work/radii", {
        checked: ["file", "terminal"],
        mounted: ["file", "terminal"],
        active: "file",
        collapsedTabs: null,
        dockFullscreen: false,
        fileTree: { ...emptyFileTreeState(), collapsed: false },
      });
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={createMockVscode()}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "文件" }));
      replyListDir("", [dirEntry("App.tsx", "/work/radii", "App.tsx", false)]);
      await user.click(await within(dock).findByTestId("file-tree-row-App.tsx"));
      expect(await within(dock).findByTestId("file-tab")).toHaveAttribute(
        "data-path",
        "/work/radii/App.tsx",
      );

      const openedFiles = usePanelGroupStore.getState().groups["/work/radii"];
      expect(
        usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs?.map(
          (tab) => tab.path,
        ),
      ).toEqual(["/work/radii/App.tsx"]);
      expect(openedFiles?.fileTabs ?? []).toEqual([]);
      expect(openedFiles?.checked).toEqual(["file", "terminal", "diff"]);
      expect(openedFiles?.active).toBe("file");

      await user.click(within(dock).getByTestId("file-tab-close"));

      const sessionAfter = usePanelGroupStore.getState().groups["/work/radii"];
      expect(sessionAfter?.checked).toEqual(["terminal", "diff"]);
      expect(sessionAfter?.active).toBe("terminal");
      expect(sessionAfter?.fileTabs ?? []).toEqual([]);
      expect(sessionAfter?.collapsedTabs).toBeNull();
      expect(sessionAfter?.dockFullscreen).toBe(false);
      expect(within(dock).queryByTestId("file-tab")).toBeNull();
      expect(within(dock).queryByTestId("desktop-panel-tab-terminal")).toBeNull();
      expect(within(dock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
        "desktop-panel-tab--active",
      );
    });
  });

  it("loads the older issue page when the transcript is scrolled near the top", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const calls: Array<[string, { before?: string; limit?: number } | undefined]> = [];
    let olderStarted = 0;
    vi.spyOn(MuseApiClient.prototype, "getMessages").mockImplementation(async (id, query) => {
      calls.push([id, query]);
      if (id !== "plan-radii") return { messages: [], hasMore: false };
      if (query?.before) {
        olderStarted += 1;
        return {
          messages: [textMessage("radii-old", "更早的圆角")],
          hasMore: false,
        };
      }
      return {
        messages: [textMessage("radii-1", RADII_MESSAGE)],
        hasMore: true,
      };
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    const transcript = within(frame).getByTestId("issue-tab-transcript");
    expect((await within(transcript).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);

    const scroller = transcript.querySelector(".messages-container");
    expect(scroller).not.toBeNull();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    fireEvent.scroll(scroller);

    expect((await within(transcript).findAllByText("更早的圆角")).length).toBeGreaterThan(0);
    expect(within(transcript).getAllByText(RADII_MESSAGE).length).toBeGreaterThan(0);
    expect(olderStarted).toBe(1);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["plan-radii", { before: "radii-1", limit: 40 }],
      ]),
    );
  });

  it("refreshes the visible issue transcript and stops while that tab is hidden", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const getMessages = vi
      .spyOn(MuseApiClient.prototype, "getMessages")
      .mockResolvedValue({
        messages: [textMessage("radii-1", RADII_MESSAGE)],
        hasMore: false,
      });
    try {
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={createMockVscode()}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      await user.click(within(dock).getByRole("button", { name: "打开会话" }));
      expect((await within(frame).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);
      const radiiCalls = () =>
        getMessages.mock.calls.filter((call) => call[0] === "plan-radii");
      expect(radiiCalls()).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(radiiCalls()).toHaveLength(2);

      await user.click(screen.getByTestId("desktop-sessions-menu"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(radiiCalls()).toHaveLength(2);

      await user.click(screen.getByTestId("desktop-assistant-menu"));
      await waitFor(() => {
        expect(radiiCalls()).toHaveLength(3);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a file path from the issue transcript in the file dock", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const onSelectSession = vi.fn();
    vi.spyOn(MuseApiClient.prototype, "getMessages").mockImplementation(async (id) => {
      if (id !== "plan-radii") return { messages: [], hasMore: false };
      return {
        messages: [
          {
            id: "radii-file",
            role: "assistant" as const,
            timestamp: "2026-10-22T00:00:00.000Z",
            blocks: [{ type: "text" as const, content: "改一下 src/App.tsx" }],
          },
        ],
        hasMore: false,
      };
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            onSelectSession,
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    const transcript = within(frame).getByTestId("issue-tab-transcript");
    const link = await within(transcript).findByRole("link", { name: "src/App.tsx" });
    await user.click(link);

    expect(onSelectSession).not.toHaveBeenCalled();
    const fileTab = await within(dock).findByTestId("file-tab");
    expect(fileTab).toHaveAttribute("data-path", "src/App.tsx");
    expect(fileTab).toHaveAttribute("data-active", "true");
    expect(fileTab.className).not.toContain("file-tab--preview");
    expect(
      usePanelGroupStore.getState().groups["/work/radii"]?.fileTabs?.map((tab) => tab.path),
    ).toEqual(["src/App.tsx"]);
    expect(
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs ?? [],
    ).toEqual([]);
    expect(within(dock).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );

    await user.click(
      within(within(dock).getByTestId("desktop-panel-tab-detail")).getByRole("button"),
    );
    expect(within(dock).getByTestId("desktop-panel-tab-detail")).toHaveClass(
      "desktop-panel-tab--active",
    );
    await user.click(link);
    expect(within(dock).getByTestId("desktop-panel-tab-detail")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dock).getByTestId("file-tab")).toHaveAttribute("data-active", "true");
  });

  it("clears unread when the issue list or tab is chosen", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const vscode = createMockVscode();
    const unread = (
      entry: DesktopSessionEntry,
    ): DesktopSessionEntry => ({ ...entry, unreadDone: true });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({
            issueGroups: [
              {
                ...RADII_ISSUE,
                sessions: [unread(session("plan-radii", "/work/radii", RADII))],
              },
              {
                ...A11Y_ISSUE,
                sessions: [
                  session("plan-a11y", "/work/a11y-plan", "规划"),
                  unread(session("exec-a11y", "/work/a11y-exec", "执行")),
                ],
              },
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const lists = await within(frame).findByTestId("bot-lists");
    expect(within(lists).queryByTestId("desktop-session-unread-dot")).toBeNull();
    await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopClearUnread",
      sessionIds: ["plan-radii"],
    });
    expect(within(frame).getAllByRole("button", { name: "Muse Bot" })).toHaveLength(1);

    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopClearUnread",
        sessionIds: ["exec-a11y"],
      });
    });
  });

  it("notifies and marks the Muse Bot tab when a message arrives off the home", async () => {
    resetWebviewStores();
    resetAssistantNoticeForTests();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          command: "assistant:chat",
          line: { id: "home", role: "assistant", message: "主页不该提示" },
        },
      }),
    );
    expect(screen.queryByTestId("assistant-notice")).toBeNull();
    expect(within(frame).queryByTestId("bot-tab-unread-dot")).toBeNull();

    const dock = await ensureAssistantDock(frame, user);
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect(botTab(frame, A11Y)).toHaveClass("active");

    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          command: "assistant:chat",
          line: { id: "away", role: "assistant", message: "事项那边有回复" },
        },
      }),
    );
    expect(screen.getByTestId("assistant-notice")).toHaveTextContent("事项那边有回复");
    expect(within(frame).getByTestId("bot-tab-unread-dot")).toBeTruthy();

    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    expect(screen.queryByTestId("assistant-notice")).toBeNull();
    expect(within(frame).queryByTestId("bot-tab-unread-dot")).toBeNull();
  });

  it("splits Muse Bot and the issue session into three columns", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const toggle = within(frame).getByTestId("assistant-column-toggle");
    expect(toggle).toBeDisabled();
    expect(frame.querySelector(".assistant-page")).toBeTruthy();
    expect(within(frame).queryByTestId("issue-tab-transcript")).toBeNull();

    const dock = await ensureAssistantDock(frame, user);
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect(toggle).toBeEnabled();

    await user.click(toggle);
    const toggleOn = within(frame).getByTestId("assistant-column-toggle");
    expect(toggleOn).toHaveAttribute("aria-pressed", "true");
    expect(frame.querySelector(".assistant-page")).toBeTruthy();
    expect(within(frame).getByTestId("issue-tab-transcript")).toBeTruthy();
    expect(within(frame).getByTestId("assistant-split-handle")).toBeTruthy();
    expect(frame.querySelector(":scope > .bot-frame-bar")).toBeNull();
    const botColumn = frame.querySelector(".assistant-split-bot") as HTMLElement;
    const issueColumn = frame.querySelector(".assistant-split-issue") as HTMLElement;
    expect(botColumn.querySelector(".assistant-split-bar")).toBeTruthy();
    expect(issueColumn.querySelector(".assistant-split-bar")).toBeTruthy();
    expect(within(botColumn).getByRole("button", { name: "Muse Bot" })).toBeDisabled();
    expect(within(issueColumn).getByRole("button", { name: A11Y })).toBeTruthy();
    expect(issueColumn.style.minWidth).toBe("520px");
    const botTab = within(botColumn).getByRole("button", { name: "Muse Bot" });

    await user.click(botTab);
    expect(frame.querySelector(".assistant-page")).toBeTruthy();
    expect(within(frame).getByTestId("issue-tab-transcript")).toBeTruthy();

    await user.click(toggleOn);
    expect(within(frame).getByTestId("assistant-column-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const botTabAgain = within(frame).getByRole("button", { name: "Muse Bot" });
    expect(botTabAgain).toBeEnabled();
    expect(frame.querySelector(":scope > .bot-frame-bar")).toBeTruthy();
    expect(within(frame).getByTestId("issue-tab-transcript")).toBeTruthy();
    expect(within(frame).queryByTestId("assistant-split-handle")).toBeNull();

    await user.click(botTabAgain);
    expect(frame.querySelector(".assistant-page")).toBeTruthy();
    expect(within(frame).queryByTestId("issue-tab-transcript")).toBeNull();
  });

  it("switches the current issue when the split session sender is focused", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [A11Y_ISSUE, RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    await user.click(within(frame).getByTestId("assistant-column-toggle"));

    const botColumn = frame.querySelector(".assistant-split-bot") as HTMLElement;
    const issueColumn = frame.querySelector(".assistant-split-issue") as HTMLElement;
    await user.click(within(botColumn).getByRole("button", { name: "事项" }));
    const menu = await screen.findByTestId("bot-lists-menu");
    await user.click(within(menu).getByRole("button", { name: new RegExp(RADII) }));
    expect(within(dock).getByRole("heading", { name: RADII })).toBeTruthy();
    expect(within(issueColumn).getByRole("button", { name: A11Y })).toBeTruthy();

    await user.click(within(issueColumn).getByTestId("message-input"));
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeTruthy();
    expect(within(dock).queryByRole("heading", { name: RADII })).toBeNull();
  });

  it("clears the Muse Bot unread and notice when the split sender is focused", async () => {
    resetWebviewStores();
    resetAssistantNoticeForTests();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    await user.click(within(frame).getByTestId("assistant-column-toggle"));

    const botColumn = frame.querySelector(".assistant-split-bot") as HTMLElement;
    const issueColumn = frame.querySelector(".assistant-split-issue") as HTMLElement;
    const away = (id: string, message: string) => {
      fireEvent(
        window,
        new MessageEvent("message", {
          data: {
            command: "assistant:chat",
            line: { id, role: "assistant", message },
          },
        }),
      );
    };

    // The left sender focuses itself on mount. Leave it before a message arrives.
    await user.click(within(issueColumn).getByRole("button", { name: A11Y }));
    away("split-away", "左侧还没看");
    expect(screen.getByTestId("assistant-notice")).toHaveTextContent("左侧还没看");
    expect(within(botColumn).getByTestId("bot-tab-unread-dot")).toBeTruthy();

    await user.click(within(botColumn).getByTestId("message-input"));
    await waitFor(() => {
      expect(screen.queryByTestId("assistant-notice")).toBeNull();
    });
    expect(within(botColumn).queryByTestId("bot-tab-unread-dot")).toBeNull();

    away("split-while-typing", "正在输入不该再提示");
    expect(screen.queryByTestId("assistant-notice")).toBeNull();
    expect(within(botColumn).queryByTestId("bot-tab-unread-dot")).toBeNull();

    await user.click(within(issueColumn).getByRole("button", { name: A11Y }));
    away("split-away-again", "回到事项后又来了");
    expect(screen.getByTestId("assistant-notice")).toHaveTextContent("回到事项后又来了");
    expect(within(botColumn).getByTestId("bot-tab-unread-dot")).toBeTruthy();
  });
});
