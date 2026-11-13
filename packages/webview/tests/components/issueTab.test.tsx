/** @vitest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { clearSessionInputDraftsForTests } from "../../src/components/chat/MessageInput";
import * as botWorkspace from "../../src/components/desktop/botWorkspace";
import { MuseApiClient } from "../../src/muse/apiClient";
import { defaultDockWidth } from "../../src/muse/panelFit";
import { resetAssistantNoticeForTests } from "../../src/components/assistant/museBotNotice";
import { ASSISTANT_PANEL_GROUP_KEY, emptyFileTreeState, resetWebviewStores, usePanelGroupStore } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import type { DesktopIssueGroup, DesktopSessionEntry, FileTreeDirEntry } from "../../src/types";
import {
  createMockDesktopHost as baseMockDesktopHost,
  createMockVscode,
  fixtures,
  sendExtensionMessage,
  sendHostMessage,
  setInputText,
} from "../webview/test-utils";
import type { DesktopHostProps } from "../../src/types";

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

function messagesForSessionId(sessionId: string) {
  if (sessionId === "plan-radii") return [textMessage("radii-1", RADII_MESSAGE)];
  if (sessionId === "exec-a11y") return [textMessage("a11y-1", A11Y_MESSAGE)];
  if (sessionId === "plan-a11y") return [textMessage("a11y-plan", "规划不该被读到")];
  return [];
}

/**
 * Desktop host that behaves like the real one when the pane asks it to switch
 * session: the selected session becomes current and its transcript arrives as a
 * host push. The issue column reads that live state instead of polling.
 */
function createMockDesktopHost(
  overrides?: Partial<DesktopHostProps>,
): DesktopHostProps {
  const host = baseMockDesktopHost(overrides);
  const providedSelect = overrides?.onSelectSession;
  host.onSelectSession = vi.fn((workdir: string, sessionId: string) => {
    providedSelect?.(workdir, sessionId);
    const paneId = overrides?.focusedPaneId ?? undefined;
    sendHostMessage({
      command: "updateCurrentSession",
      ...(paneId ? { paneId } : {}),
      session: {
        id: sessionId,
        sessionType: "main",
        workdir,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });
    // The real host pushes the activated session's transcript. Go through the
    // API client so a test that stubs getMessages (or fetch) still provides
    // the content, then push it the way the host does.
    const client = new MuseApiClient({ baseUrl: "http://127.0.0.1:1" });
    void client
      .getMessages(sessionId)
      .then((page) => {
        sendHostMessage({
          ...fixtures.updateMessages(page.messages),
          hasMore: page.hasMore,
          ...(paneId ? { paneId } : {}),
        } as never);
      })
      .catch(() => {
        sendHostMessage({
          ...fixtures.updateMessages(messagesForSessionId(sessionId)),
          ...(paneId ? { paneId } : {}),
        } as never);
      });
  });
  return host;
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
          title: "灵光",
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

function seedAssistantFile(path: string, workdir: string) {
  usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
    checked: ["file", "diff"],
    mounted: ["file", "diff"],
    active: "file",
    fileTabs: [{ path, host: "" }],
    activeFilePath: path,
    fileTree: { ...emptyFileTreeState(), collapsed: false },
  });
  usePanelGroupStore.getState().patchGroup(workdir, {
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
    clearSessionInputDraftsForTests();
    delete (HTMLElement.prototype as { loadURL?: unknown }).loadURL;
  });

  it("restores the session-page chat when leaving Muse Bot", async () => {
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

    await screen.findByTestId("assistant-frame");
    sendExtensionMessage({
      command: "setInitialState",
      messages: [textMessage("notes-1", NOTES_MESSAGE)],
      session: { id: "sess-notes", title: "会议记录" },
      workdir: "/work/notes",
    });
    sendExtensionMessage({
      command: "setInitialState",
      messages: [],
      session: { id: "assistant", title: "灵光" },
      workdir: "/tmp/proj",
    });

    await user.click(screen.getByTestId("desktop-sessions-menu"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "sess-notes",
    });
    expect((await screen.findAllByText(NOTES_MESSAGE)).length).toBeGreaterThan(0);
  });

  it("keeps session composer text when leaving for the assistant and coming back", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
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

    await screen.findByTestId("assistant-frame");
    sendExtensionMessage({
      command: "setInitialState",
      messages: [textMessage("notes-1", NOTES_MESSAGE)],
      session: { id: "sess-notes", title: "会议记录" },
      workdir: "/work/notes",
      isAuthenticated: true,
    });

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    const input = await screen.findByTestId("message-input");
    await setInputText(input, "还没发出去");
    expect(input.innerText).toBe("还没发出去");

    await user.click(screen.getByTestId("desktop-assistant-menu"));
    expect(screen.getByTestId("assistant-frame")).toBeInTheDocument();

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(await screen.findByTestId("message-input")).toHaveTextContent("还没发出去");
  });

  it("opens 新对话 from the sessions page without bouncing back", async () => {
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

    sendExtensionMessage({
      command: "setInitialState",
      messages: [textMessage("notes-1", NOTES_MESSAGE)],
      session: { id: "sess-notes", title: "会议记录" },
      workdir: "/work/notes",
      isAuthenticated: true,
    });
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect((await screen.findAllByText(NOTES_MESSAGE)).length).toBeGreaterThan(0);

    vscode.postMessage.mockClear();
    await user.click(screen.getByTestId("desktop-new-session"));

    expect(await screen.findByTestId("new-session-page")).toBeInTheDocument();
    expect(screen.queryByText(NOTES_MESSAGE)).toBeNull();
    expect(screen.getByTestId("desktop-session-item-sess-notes").className).not.toContain(
      "desktop-session-item--current",
    );
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: "newSession" });
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "sess-notes",
    });

    sendExtensionMessage({ command: "updateMessages", messages: [] });
    sendExtensionMessage({
      command: "updateCurrentSession",
      session: {
        id: "__draft__",
        sessionType: "main",
        workdir: "",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "sess-notes",
    });

    sendExtensionMessage({
      command: "updateCurrentSession",
      session: {
        id: "sess-notes",
        sessionType: "main",
        workdir: "/work/notes",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
        firstMessage: "会议记录",
      },
    });
    expect((await screen.findAllByText(NOTES_MESSAGE)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("new-session-page")).toBeNull();
  });

  it("keeps the first message when a new session is created", async () => {
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

    sendExtensionMessage({
      command: "setInitialState",
      messages: [textMessage("notes-1", NOTES_MESSAGE)],
      session: { id: "sess-notes", title: "会议记录" },
      workdir: "/work/notes",
      isAuthenticated: true,
    });
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    await user.click(screen.getByTestId("desktop-new-session"));
    expect(await screen.findByTestId("new-session-page")).toBeInTheDocument();

    sendExtensionMessage({ command: "updateMessages", messages: [] });
    sendExtensionMessage({
      command: "updateCurrentSession",
      session: {
        id: "__draft__",
        sessionType: "main",
        workdir: "",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });
    vscode.postMessage.mockClear();

    const sent = "帮我看一下这个项目";
    sendExtensionMessage({
      command: "appendMessage",
      message: textMessage("user_1", sent),
    });
    sendExtensionMessage({
      command: "updateCurrentSession",
      session: {
        id: "sess-created",
        sessionType: "main",
        workdir: "/tmp/muse-project",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    expect(screen.getAllByText(sent).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("new-session-page")).toBeNull();
    expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: "newSession" });
  });

  it("switches the sidebar to 会话 when Cmd+N starts a draft from Muse Bot", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const vscode = createMockVscode();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({
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

    sendExtensionMessage({
      command: "setInitialState",
      messages: [textMessage("notes-1", NOTES_MESSAGE)],
      session: { id: "sess-notes", title: "会议记录" },
      workdir: "/work/notes",
      isAuthenticated: true,
    });
    expect(await screen.findByTestId("assistant-frame")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-assistant-menu").className).toContain("active");

    vscode.postMessage.mockClear();
    sendExtensionMessage({ command: "desktopNewSessionShortcut" });

    expect(screen.getByTestId("desktop-sessions-menu").className).toContain("active");
    expect(screen.getByTestId("desktop-assistant-menu").className).not.toContain(
      "active",
    );
    expect(screen.getByTestId("desktop-session-list")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-frame")).toBeNull();
    expect(await screen.findByTestId("new-session-page")).toBeInTheDocument();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: "newSession" });
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "sess-notes",
    });
  });

  it("opens the issue transcript from detail without leaving Muse Bot", async () => {
    resetWebviewStores();
    const fetched: string[] = [];
    stubAssistant(fetched);
    stubWideViewport();
    seedAssistantFile("/work/radii/App.tsx", "/work/radii");
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
    const tree = await within(dock).findByTestId("file-tree-workdir");
    expect(tree).toHaveTextContent("radii");
    expect(tree).toHaveAttribute("title", "/work/radii");

    fireEvent.click(within(dock).getByRole("button", { name: "打开会话", hidden: true }));

    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");
    // The file tab is assistant-level now and stays after the issue opens.
    expect(within(dock).getByTestId("file-tab")).toBeInTheDocument();
    expect(botTab(frame, RADII)).toHaveClass("active");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect((await within(frame).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);
    expect(screen.queryByText("今天想让我帮你做些什么？")).toBeNull();
    expect(within(frame).queryByTestId("bot-lists")).toBeNull();
    expect(within(frame).queryByRole("button", { name: "待处理" })).toBeNull();
    expect(within(frame).getByRole("button", { name: "事项" })).toBeInTheDocument();

    await user.click(within(frame).getByRole("button", { name: "灵光" }));
    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(within(frame).queryByTestId("issue-session-title")).toBeNull();
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();

    await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
    expect(within(dock).getByRole("heading", { name: RADII })).toBeInTheDocument();
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

    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");
    expect(within(paneA).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect((await within(paneA).findAllByText(RADII_MESSAGE)).length).toBeGreaterThan(0);
    expect(within(paneB).queryByTestId("issue-session-header")).toBeNull();

    await user.click(screen.getByTestId("desktop-automations-menu"));
    await user.click(screen.getByTestId("desktop-settings-btn"));
    await user.click(screen.getByTestId("desktop-assistant-menu"));
    const paneAgain = await screen.findByTestId("desktop-pane-pane-a");
    expect(botTab(paneAgain, RADII)).toHaveClass("active");
    expect(within(paneAgain).getByTestId("issue-session-title")).toHaveTextContent(RADII);
  });

  it("keeps the session directory on 会话 when the bot's issue changes", async () => {
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
      expect(tree).toHaveAttribute("title", "/work/notes");
      expect(tree).not.toHaveAttribute("title", "/work/radii");

      await user.click(screen.getByTestId("desktop-assistant-menu"));
      const frame = await screen.findByTestId("assistant-frame");
      const lists = within(frame).getByTestId("bot-lists");
      await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
      await user.click(screen.getByTestId("desktop-sessions-menu"));

      const chatAgain = await screen.findByTestId("chat-container");
      const dockAgain = await within(chatAgain).findByTestId("desktop-panel-dock");
      const nextTree = await within(dockAgain).findByTestId("file-tree-workdir");
      expect(nextTree).toHaveAttribute("title", "/work/notes");
      expect(nextTree).not.toHaveAttribute("title", "/work/a11y-exec");
    });
  });

  it("opens the clicked issue file change in the diff pane", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    vi.spyOn(MuseApiClient.prototype, "getMessages").mockImplementation(async (id) => {
      if (id !== "plan-radii") return { messages: [], hasMore: false };
      return {
        messages: [
          textMessage("u1", "改一下圆角"),
          {
            id: "a1",
            role: "assistant",
            timestamp: "2026-10-22T00:00:01.000Z",
            blocks: [
              { type: "text", content: "改好了" },
              {
                type: "file_history",
                snapshots: [
                  {
                    filePath: "/work/radii/app.tsx",
                    operation: "modify",
                    additions: 2,
                    deletions: 1,
                    hunks: "@@ -1 +1 @@\n-old\n+new\n",
                  },
                ],
              },
            ],
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
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话", hidden: true }));
    const card = await within(frame).findByTestId("file-history-card");
    await user.click(within(card).getByTestId("file-history-card-row"));

    expect(within(frame).getByTestId("desktop-panel-tab-diff")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(await within(frame).findByTestId("diff-mode-select")).toHaveTextContent(
      "最近一次修改",
    );
    expect(within(frame).getByTestId("diff-file-path")).toHaveTextContent("app.tsx");
  });

  it("switches the dock to the file tab when a diff path is clicked", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const vscode = createMockVscode();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByTestId("desktop-panel-tab-diff").querySelector("button")!);
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopGetWorkspaceDiff" }),
      );
    });
    sendExtensionMessage({
      command: "desktopWorkspaceDiff",
      result: {
        kind: "ok",
        files: [
          {
            path: ".scratch/ai-stage-scheduler/map.md",
            status: "added",
            additions: 3,
            deletions: 0,
            hunks: "@@ -0,0 +1,3 @@\n+---\n+title: map\n+label: wayfinder:map\n",
          },
        ],
      },
    });
    const path = await within(dock).findByTestId("diff-file-path");
    expect(path).toHaveTextContent("map.md");
    await user.click(path);

    const fileTab = await within(dock).findByTestId("file-tab");
    expect(fileTab).toHaveAttribute("data-path", expect.stringContaining("map.md"));
    expect(fileTab).toHaveAttribute("data-active", "true");
    expect(within(dock).getByTestId("desktop-panel-tab-diff")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dock).getByTestId("file-pane").closest(".desktop-panel-slot")).not.toHaveStyle({
      display: "none",
    });
  });

  it("switches a session dock to the file when a diff path is clicked", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
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
    sendExtensionMessage({
      command: "setInitialState",
      messages: [
        textMessage("u1", "写一下地图"),
        {
          id: "a1",
          role: "assistant",
          timestamp: "2026-10-22T00:00:01.000Z",
          blocks: [
            { type: "text", content: "写好了" },
            {
              type: "file_history",
              snapshots: [
                {
                  filePath: "/work/notes/.scratch/ai-stage-scheduler/map.md",
                  operation: "modify",
                  additions: 3,
                  deletions: 0,
                  hunks: "@@ -0,0 +1,3 @@\n+---\n+title: map\n+label: wayfinder:map\n",
                },
              ],
            },
          ],
        },
      ],
      session: { id: "sess-notes", title: "会议记录" },
      workdir: "/work/notes",
      isAuthenticated: true,
    });
    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect((await screen.findAllByText("写一下地图")).length).toBeGreaterThan(0);

    const card = await screen.findByTestId("file-history-card");
    await user.click(within(card).getByTestId("file-history-card-row"));
    const dock = await screen.findByTestId("desktop-panel-dock");
    const path = await within(dock).findByTestId("diff-file-path");
    expect(within(dock).getByTestId("desktop-panel-tab-diff")).toHaveClass(
      "desktop-panel-tab--active",
    );
    await user.click(path);

    const fileTab = await within(dock).findByTestId("file-tab");
    expect(fileTab).toHaveAttribute("data-active", "true");
    expect(within(dock).getByTestId("desktop-panel-tab-diff")).not.toHaveClass(
      "desktop-panel-tab--active",
    );
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

  it("opens a bot terminal tab when no issue is current", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      dockColumnOpen: true,
      tools: [{ id: "term-1", kind: "terminal", workdir: "/tmp/proj" }],
      activeToolId: "term-1",
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({ issueGroups: [] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    const tab = within(dock).getByTestId("desktop-panel-tool-term-1");
    expect(tab).not.toHaveClass("desktop-panel-tab--active");
    await user.click(within(tab).getByRole("button", { name: "proj" }));
    expect(tab).toHaveClass("desktop-panel-tab--active");
    expect(within(dock).getByTestId("terminal-pane")).toBeVisible();
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
    // No file is open, so the tree falls back to the assistant's own directory.
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

  it("uses the session directory dock on 会话 instead of the issue dock", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      checked: ["diff"],
      mounted: ["diff"],
      active: "diff",
    });
    usePanelGroupStore.getState().patchGroup("/work/notes", {
      checked: ["terminal", "diff"],
      mounted: ["terminal", "diff"],
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
    expect(within(dock).getByTestId("terminal-pane")).toBeInTheDocument();
    expect(within(dock).queryByTestId("file-tree-workdir")).toBeNull();

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

    expect(within(dock).getByTestId("terminal-pane")).toBeInTheDocument();
    const diffCalls = vscode.postMessage.mock.calls
      .map((call) => call[0] as { command?: string; workdir?: string })
      .filter((message) => message.command === "desktopGetWorkspaceDiff");
    expect(diffCalls.some((message) => message.workdir === "/work/radii")).toBe(false);
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

  it("stores a file-content reply on the assistant tab group", async () => {
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
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs?.map(
        (tab) => tab.path,
      ),
    ).toEqual(["/work/radii/App.tsx"]);
    expect(
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.activeFilePath,
    ).toBe("/work/radii/App.tsx");
    expect(
      usePanelGroupStore.getState().groups["issue:radii"]?.fileTabs ?? [],
    ).toEqual([]);
  });

  it("closes the last file tab and leaves the other tab kinds", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file", "terminal"],
      mounted: ["file", "terminal"],
      active: "file",
      fileTabs: [{ path: "/work/radii/App.tsx", host: "" }],
      activeFilePath: "/work/radii/App.tsx",
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
    expect(await within(dock).findByTestId("file-tab")).toHaveAttribute(
      "data-path",
      "/work/radii/App.tsx",
    );

    await user.click(within(dock).getByTestId("file-tab-close"));

    const group = usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY];
    expect(group?.fileTabs ?? []).toEqual([]);
    expect(group?.checked).toEqual(["terminal", "diff"]);
    expect(group?.active).toBe("terminal");
    expect(group?.collapsedTabs).toBeNull();
    expect(group?.dockFullscreen).toBe(false);
    expect(within(dock).queryByTestId("file-tab")).toBeNull();
    expect(within(dock).getByTestId("desktop-panel-tab-terminal")).toBeInTheDocument();
  });

  it("turns the issue sender into stop while that session is running", async () => {
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
            issueGroups: [
              {
                ...RADII_ISSUE,
                sessions: [{ ...session("plan-radii", "/work/radii", RADII), running: true }],
              },
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    const transcript = within(frame).getByTestId("issue-tab-transcript");
    const abort = await within(transcript).findByTestId("abort-btn");
    expect(within(transcript).queryByTestId("send-btn")).toBeNull();
    expect(within(transcript).getByTestId("thinking-hint")).toHaveTextContent("正在处理");
    await user.click(abort);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "abortMessage",
      sessionId: "plan-radii",
    });
  });

  it("asks the host for the older page when the transcript is scrolled near the top", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    vi.spyOn(MuseApiClient.prototype, "getMessages").mockImplementation(async (id) => {
      if (id !== "plan-radii") return { messages: [], hasMore: false };
      return {
        messages: [textMessage("radii-1", RADII_MESSAGE)],
        hasMore: true,
      };
    });
    const vscode = createMockVscode();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
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
    scroller!.scrollTop = 0;
    fireEvent.scroll(scroller!);

    // One session on screen: paging older messages is the chat's own command.
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "loadOlderMessages",
        before: "radii-1",
      });
    });
  });

  it("activates the issue session when its transcript is open", async () => {
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
            issueGroups: [RADII_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "plan-radii",
    });
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect(await within(frame).findByTestId("issue-tab-transcript")).toBeTruthy();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "plan-radii",
    });

    await user.click(within(frame).getByRole("button", { name: "灵光" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopSelectSession",
      sessionId: "assistant",
    });
  });

  it("keeps the file tab across issues and derives the tree from the open file", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file", "diff"],
      mounted: ["file", "diff"],
      active: "file",
      fileTabs: [{ path: "/work/radii/a.ts", host: "" }],
      activeFilePath: "/work/radii/a.ts",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    usePanelGroupStore.getState().patchGroup("/work/radii", {
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const host = createMockDesktopHost({
      issueGroups: [RADII_ISSUE, A11Y_ISSUE],
      recentWorkdirs: ["/work/radii"],
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={host} />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(within(dock).getByTestId("file-tab")).toBeInTheDocument();
    expect(await within(dock).findByTestId("file-tree-workdir")).toHaveTextContent(
      "radii",
    );

    fireEvent.click(within(dock).getByRole("button", { name: "打开会话", hidden: true }));
    expect(within(dock).getByTestId("file-tab")).toBeInTheDocument();
    expect(await within(dock).findByTestId("file-tree-workdir")).toHaveTextContent(
      "radii",
    );
  });

  it("falls back to the current issue tree when the active file is outside known workdirs", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTabs: [{ path: "/outside/notes.txt", host: "" }],
      activeFilePath: "/outside/notes.txt",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE],
            recentWorkdirs: ["/work/radii"],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(within(dock).getByTestId("file-tab")).toBeInTheDocument();
    expect(await within(dock).findByTestId("file-tree-workdir")).toHaveAttribute(
      "title",
      "/work/radii",
    );
    expect(within(dock).getByTestId("file-tree")).toBeInTheDocument();
  });

  it("surfaces the file tree from the + menu while a file tab is open", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTabs: [{ path: "/work/radii/App.tsx", host: "" }],
      activeFilePath: "/work/radii/App.tsx",
      fileTree: { ...emptyFileTreeState(), collapsed: true },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));
    await user.click(await screen.findByTestId("panel-add-item-file"));

    expect(within(dock).getByTestId("file-tab")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(await within(dock).findByTestId("file-tree")).toBeVisible();
    expect(
      within(dock).getByText("从消息或文件树打开文件"),
    ).toBeInTheDocument();
  });

  it("turns the 开始 tab into a visible 文件 panel from the + picker", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    seedAssistantFile("/work/radii/App.tsx", "/work/radii");
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByTestId("desktop-panel-add-btn"));

    expect(within(dock).getByTestId("desktop-panel-tab-new")).toHaveTextContent(
      "开始",
    );
    expect(within(dock).queryByTestId("desktop-panel-add-btn")).toBeNull();

    await user.click(await screen.findByTestId("panel-add-item-file"));

    expect(within(dock).queryByTestId("panel-picker")).toBeNull();
    expect(within(dock).getByTestId("desktop-panel-tab-file")).toHaveClass(
      "desktop-panel-tab--active",
    );
    expect(within(dock).getByTestId("file-tab")).toBeInTheDocument();
    expect(within(dock).getByTestId("desktop-panel-add-btn")).toBeInTheDocument();
  });

  it("opens a fresh file browser with the file-panel shortcut", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    seedAssistantFile("/work/radii/App.tsx", "/work/radii");
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);

    act(() => {
      fireEvent.keyDown(window, { key: "g", metaKey: true });
      fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    });

    expect(
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.activeFilePath,
    ).toBeNull();
    expect(await within(dock).findByTestId("file-tree")).toBeVisible();
  });

  it("opens a new terminal with the new-terminal shortcut", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    await ensureAssistantDock(frame, user);
    const terminals = () =>
      (usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [])
        .filter((tool) => tool.kind === "terminal").length;
    expect(terminals()).toBe(0);

    act(() => {
      fireEvent.keyDown(window, { key: "j", metaKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
    });

    await waitFor(() => expect(terminals()).toBe(1));
  });

  it("opens or focuses a terminal with the terminal shortcut", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({ issueGroups: [RADII_ISSUE] })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    await ensureAssistantDock(frame, user);
    const terminals = () =>
      (usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [])
        .filter((tool) => tool.kind === "terminal").length;

    act(() => {
      fireEvent.keyDown(window, {
        key: "`",
        code: "Backquote",
        metaKey: true,
      });
      fireEvent.keyDown(window, {
        key: "`",
        code: "Backquote",
        ctrlKey: true,
      });
    });

    await waitFor(() => expect(terminals()).toBe(1));
  });

  it("shows the current issue directory tree when no file is open yet", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        checked: ["file"],
        mounted: ["file"],
        active: "file",
        fileTree: { ...emptyFileTreeState(), collapsed: false },
      });
      const vscode = createMockVscode();
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <ChatApp
            vscode={vscode}
            host={createMockDesktopHost({
              issueGroups: [RADII_ISSUE],
            })}
          />
        </MuseTheme>,
      );

      const frame = await screen.findByTestId("assistant-frame");
      const dock = await ensureAssistantDock(frame, user);
      expect(await within(dock).findByTestId("file-tree-workdir")).toHaveAttribute(
        "title",
        "/work/radii",
      );

      await waitFor(() => {
        expect(
          listDirMessages(vscode).some(
            (message) => message.dir === "" && message.workdir === "/work/radii",
          ),
        ).toBe(true);
      });
      const firstList = listDirMessages(vscode).find(
        (message) => message.dir === "" && message.workdir === "/work/radii",
      ) as { requestId?: string } | undefined;
      sendExtensionMessage({
        command: "desktopListDirResult",
        requestId: firstList?.requestId,
        dir: "",
        entries: [dirEntry("App.tsx", "/work/radii", "App.tsx", false)],
      });
      await user.click(await within(dock).findByTestId("file-tree-row-App.tsx"));
      expect(await within(dock).findByTestId("file-tab")).toHaveAttribute(
        "data-path",
        "/work/radii/App.tsx",
      );
    });
  });

  it("moves the file tree to the workdir that owns the active file", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["file"],
      mounted: ["file"],
      active: "file",
      fileTabs: [
        { path: "/work/radii/a.ts", host: "" },
        { path: "/work/a11y-exec/b.ts", host: "" },
      ],
      activeFilePath: "/work/radii/a.ts",
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            issueGroups: [RADII_ISSUE, A11Y_ISSUE],
            recentWorkdirs: ["/work/radii"],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    expect(await within(dock).findByTestId("file-tree-workdir")).toHaveAttribute(
      "title",
      "/work/radii",
    );

    const a11yTab = within(dock)
      .getAllByTestId("file-tab")
      .find((tab) => tab.getAttribute("data-path") === "/work/a11y-exec/b.ts");
    expect(a11yTab).toBeTruthy();
    await user.click(a11yTab!);
    expect(await within(dock).findByTestId("file-tree-workdir")).toHaveAttribute(
      "title",
      "/work/a11y-exec",
    );
  });

  it("keeps the open issue sender usable when the host session belongs to a closed issue", async () => {
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
            issueGroups: [{ ...RADII_ISSUE, status: "review" }],
            closedIssueGroups: [
              {
                ...issue({
                  issueId: "closed-plan",
                  title: "已经关了",
                  priority: "p1",
                  planningSessionId: "plan-closed",
                  sessions: [session("plan-closed", "/work/closed", "已经关了")],
                }),
                status: "completed",
              },
            ],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    const transcript = await within(frame).findByTestId("issue-tab-transcript");
    sendExtensionMessage({
      command: "setInitialState",
      messages: [],
      session: { id: "plan-closed", title: "已经关了" },
      workdir: "/work/closed",
    });

    // Activating the issue's session is asynchronous now.
    const input = await within(transcript).findByTestId("message-input");
    expect(input.getAttribute("contentEditable")).toBe("true");
    expect(input.getAttribute("data-placeholder")).not.toBe(
      "这条 Issue 已关闭，不能再发消息",
    );
    await setInputText(input, "继续改");
    await user.click(within(transcript).getByTestId("send-btn"));
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sendMessage",
        text: "继续改",
        sessionId: "plan-radii",
      }),
    );
  });

  it("sends from the execution tab into the planning session and switches to it", async () => {
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
            issueGroups: [A11Y_ISSUE],
          })}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    const dock = await ensureAssistantDock(frame, user);
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    const transcript = await within(frame).findByTestId("issue-tab-transcript");
    expect(within(frame).getByTestId("issue-session-tab-execution")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const input = within(transcript).getByTestId("message-input");
    await setInputText(input, "改一下方案");
    await user.click(within(transcript).getByTestId("send-btn"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sendMessage",
        text: "改一下方案",
        sessionId: "plan-a11y",
      }),
    );
    expect(within(frame).getByTestId("issue-session-tab-planning")).toHaveAttribute(
      "aria-selected",
      "true",
    );
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

    const fileTab = await within(dock).findByTestId("file-tab");
    expect(fileTab).toHaveAttribute("data-path", "src/App.tsx");
    expect(fileTab).toHaveAttribute("data-active", "true");
    expect(fileTab.className).not.toContain("file-tab--preview");
    expect(
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs?.map(
        (tab) => tab.path,
      ),
    ).toEqual(["src/App.tsx"]);
    expect(
      usePanelGroupStore.getState().groups["issue:radii"]?.fileTabs ?? [],
    ).toEqual([]);
    expect(
      usePanelGroupStore.getState().groups["/work/radii"]?.fileTabs ?? [],
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
    expect(within(frame).getAllByRole("button", { name: "灵光" })).toHaveLength(1);

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

    await user.click(within(frame).getByRole("button", { name: "灵光" }));
    expect(screen.queryByTestId("assistant-notice")).toBeNull();
    expect(within(frame).queryByTestId("bot-tab-unread-dot")).toBeNull();
  });

});
