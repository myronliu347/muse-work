/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
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
    resetWebviewStores();
    delete (HTMLElement.prototype as { loadURL?: unknown }).loadURL;
  });

  it("opens the issue transcript from detail without leaving Muse Bot", async () => {
    resetWebviewStores();
    const fetched: string[] = [];
    stubAssistant(fetched);
    stubWideViewport();
    seedFileGroup(ASSISTANT_PANEL_GROUP_KEY);
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
    const dock = await within(frame).findByTestId("desktop-panel-dock");
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
    expect(within(frame).getByRole("button", { name: RADII })).toHaveClass("active");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(await within(frame).findByText(RADII_MESSAGE)).toBeInTheDocument();
    expect(fetched.some((url) => url.includes("/sessions/plan-radii/messages"))).toBe(true);
    expect(fetched.some((url) => url.includes("/sessions/exec-a11y/messages"))).toBe(false);
    expect(screen.queryByText("今天想让我帮你做些什么？")).toBeNull();

    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(within(frame).getByRole("button", { name: RADII })).toHaveClass("active");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(frame).getByText(RADII_MESSAGE)).toBeInTheDocument();

    await user.click(within(lists).getByRole("button", { name: new RegExp(RADII) }));
    await user.click(within(frame).getByRole("button", { name: "Muse Bot" }));
    expect(within(dock).getByRole("button", { name: "切到会话" })).toBeInTheDocument();
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "打开会话" })).toBeInTheDocument();

    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(within(frame).getByRole("button", { name: A11Y })).toHaveClass("active");
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(A11Y);
    expect(await within(frame).findByText(A11Y_MESSAGE)).toBeInTheDocument();
    expect(fetched.some((url) => url.includes("/sessions/exec-a11y/messages"))).toBe(true);
    expect(within(frame).queryByText("规划不该被读到")).toBeNull();
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();

    await user.click(within(frame).getByRole("button", { name: RADII }));
    expect(within(frame).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "切到会话" })).toBeInTheDocument();
    await user.click(within(dock).getByRole("button", { name: "切到会话" }));
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(within(frame).getByRole("button", { name: A11Y })).toHaveClass("active");
    expect(within(frame).getByRole("button", { name: RADII })).not.toHaveClass("active");
    expect(within(dock).getByRole("heading", { name: A11Y })).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "切到会话" })).toBeNull();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");

    await user.click(within(frame).getByRole("button", { name: RADII }));
    await user.click(within(lists).getByRole("button", { name: new RegExp(QUEUE_TITLE) }));
    expect(within(dock).getByText(QUEUE_TITLE)).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "打开会话" })).toBeNull();
    await user.click(within(dock).getByRole("button", { name: "文件" }));
    const queuedTree = await within(dock).findByTestId("file-tree-workdir");
    expect(queuedTree).toHaveTextContent("a11y-exec");
    expect(queuedTree).toHaveAttribute("title", "/work/a11y-exec");
    expect(queuedTree).not.toHaveTextContent("proj");

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
    expect(sessionTree).toHaveAttribute("title", "/work/a11y-exec");
    expect(sessionTree).not.toHaveTextContent("notes");

    const callsAfterSession = onSelectSession.mock.calls.length;
    await user.click(screen.getByTestId("desktop-assistant-menu"));
    const back = await screen.findByTestId("assistant-frame");
    expect(within(back).getByRole("button", { name: RADII })).toHaveClass("active");
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

    const dock = await screen.findByTestId("desktop-panel-dock");
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
    const dock = await within(frame).findByTestId("desktop-panel-dock");
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));
    expect(await within(frame).findByText(RADII_MESSAGE)).toBeInTheDocument();

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    expect(document.querySelector(".bot-tabs")).toBeNull();
    await user.click(screen.getByTestId("desktop-automations-menu"));
    expect(await screen.findByTestId("automations-page")).toBeInTheDocument();
    await user.click(screen.getByTestId("desktop-settings-btn"));
    expect(await screen.findByTestId("desktop-settings-page")).toBeInTheDocument();
    await user.click(screen.getByTestId("desktop-assistant-menu"));

    const back = await screen.findByTestId("assistant-frame");
    expect(within(back).getByRole("button", { name: RADII })).toHaveClass("active");
    expect(within(back).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(within(back).getByText(RADII_MESSAGE)).toBeInTheDocument();
    expect(within(back).queryByText("今天想让我帮你做些什么？")).toBeNull();
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
    const dock = await within(paneA).findByTestId("desktop-panel-dock");
    await user.click(within(dock).getByRole("button", { name: "打开会话" }));

    expect(onSelectSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("desktop-sessions-menu").className).not.toContain("active");
    expect(within(paneA).getByTestId("issue-session-title")).toHaveTextContent(RADII);
    expect(await within(paneA).findByText(RADII_MESSAGE)).toBeInTheDocument();
    expect(within(paneB).queryByTestId("issue-session-header")).toBeNull();
    expect(fetched.some((url) => url.includes("/sessions/plan-radii/messages"))).toBe(true);

    await user.click(screen.getByTestId("desktop-automations-menu"));
    await user.click(screen.getByTestId("desktop-settings-btn"));
    await user.click(screen.getByTestId("desktop-assistant-menu"));
    const paneAgain = await screen.findByTestId("desktop-pane-pane-a");
    expect(within(paneAgain).getByRole("button", { name: RADII })).toHaveClass("active");
    expect(within(paneAgain).getByTestId("issue-session-title")).toHaveTextContent(RADII);
  });

  it("refetches an expanded directory for the next issue instead of reusing cached children", async () => {
    await withElementBox(async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    seedFileGroup(ASSISTANT_PANEL_GROUP_KEY);
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
    const dock = await within(frame).findByTestId("desktop-panel-dock");
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

    await waitFor(() => {
      expect(listDirMessages(vscode)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dir: "src", workdir: "/work/a11y-exec" }),
        ]),
      );
    });
    expect(within(dock).queryByTestId("file-tree-row-src/old-child.ts")).toBeNull();
    expect(within(dock).queryByText("old-child.ts")).toBeNull();
    });
  });

  it("refetches a session-surface directory after another issue is selected", async () => {
    await withElementBox(async () => {
      resetWebviewStores();
      stubAssistant([]);
      stubWideViewport();
      seedFileGroup(ASSISTANT_PANEL_GROUP_KEY);
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
      const dockAgain = await within(chatAgain).findByTestId("desktop-panel-dock");
      const fileTab = within(dockAgain).queryByRole("button", { name: "文件" });
      if (fileTab && !fileTab.className.includes("desktop-panel-tab--active")) {
        await user.click(fileTab);
      }
      const nextTree = await within(dockAgain).findByTestId("file-tree-workdir");
      expect(nextTree).toHaveAttribute("title", "/work/a11y-exec");
      await waitFor(() => {
        expect(listDirMessages(vscode)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ dir: "src", workdir: "/work/a11y-exec" }),
          ]),
        );
      });
      expect(within(dockAgain).queryByTestId("file-tree-row-src/old-child.ts")).toBeNull();
      expect(within(dockAgain).queryByText("old-child.ts")).toBeNull();
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

  it("keeps a separate browser preview for each issue", async () => {
    resetWebviewStores();
    stubAssistant([]);
    stubWideViewport();
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      checked: ["preview"],
      mounted: ["preview"],
      active: "preview",
      previewUrl: "http://shared.example/",
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
    const dock = await within(frame).findByTestId("desktop-panel-dock");
    await user.click(within(dock).getByRole("button", { name: "浏览器" }));
    const address = within(dock).getByTestId("preview-address");
    expect(address).not.toHaveValue("http://shared.example/");
    await user.click(address);
    await user.type(address, "http://radii.test");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(address).toHaveValue("http://radii.test/");
    });
    expect(usePanelGroupStore.getState().groups["/work/radii"]?.previewUrl).toBe(
      "http://radii.test/",
    );
    expect(within(dock).getByTestId("desktop-panel-tab-preview")).toHaveClass(
      "desktop-panel-tab--active",
    );

    const lists = within(frame).getByTestId("bot-lists");
    await user.click(within(lists).getByRole("button", { name: new RegExp(A11Y) }));
    await waitFor(() => {
      expect(within(dock).getByTestId("preview-address")).not.toHaveValue("http://radii.test/");
    });
    expect(usePanelGroupStore.getState().groups["/work/radii"]?.previewUrl).toBe(
      "http://radii.test/",
    );
    expect(usePanelGroupStore.getState().groups["/work/a11y-exec"]?.previewUrl ?? null).toBeNull();

    await user.click(within(dock).getByRole("button", { name: "浏览器" }));
    const nextAddress = within(dock).getByTestId("preview-address");
    await user.click(nextAddress);
    await user.type(nextAddress, "http://a11y.test");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(nextAddress).toHaveValue("http://a11y.test/");
    });
    expect(usePanelGroupStore.getState().groups["/work/radii"]?.previewUrl).toBe(
      "http://radii.test/",
    );
    expect(usePanelGroupStore.getState().groups["/work/a11y-exec"]?.previewUrl).toBe(
      "http://a11y.test/",
    );
    expect(usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.previewUrl).not.toBe(
      "http://a11y.test/",
    );
  });
});
