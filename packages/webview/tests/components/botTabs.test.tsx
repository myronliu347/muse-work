/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { BotTabs, useBotWorkspaceController } from "../../src/components/desktop/BotTabs";
import { DesktopShell } from "../../src/components/desktop/DesktopShell";
import {
  initialBotWorkspace,
  openIssueSession,
} from "../../src/components/desktop/botWorkspace";
import { ShellSurfaceProvider } from "../../src/components/desktop/shellSurface";
import { MuseApiClient } from "../../src/muse/apiClient";
import { resetWebviewStores } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import {
  createMockDesktopHost,
  createMockVscode,
  establishSession,
} from "../webview/test-utils";

const ISSUE_ID = "radii";
const ISSUE_TITLE = "圆角还没对齐";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubEmptyAssistant() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/messages")) {
        return jsonResponse({ messages: [], hasMore: false });
      }
      if (url.includes("/assistant/queue")) {
        return jsonResponse({ items: [] });
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
      if (url.includes("/providers")) {
        return jsonResponse({
          providers: [],
          active: { providerId: "stub", modelId: "stub" },
        });
      }
      return jsonResponse({});
    }),
  );
}

describe("BotTabs", () => {
  it("switches the focused side column's tab with Cmd+[ ]", () => {
    const onFocus = vi.fn();
    const onClose = vi.fn();
    let state = initialBotWorkspace(null);
    state = openIssueSession(state, "a");
    state = openIssueSession(state, "b");
    state = openIssueSession(state, "c");
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const chord = mac ? { metaKey: true } : { ctrlKey: true };
    render(
      <div className="assistant-split-issue">
        <BotTabs
          state={state}
          titles={{ a: "A", b: "B", c: "C" }}
          scope="issues"
          onFocus={onFocus}
          onClose={onClose}
        />
        <button type="button" data-testid="issue-body">
          body
        </button>
      </div>,
    );

    const body = screen.getByTestId("issue-body");
    body.focus();
    fireEvent.keyDown(body, { key: "[", code: "BracketLeft", ...chord });
    expect(onFocus).toHaveBeenCalledWith("b");

    onFocus.mockClear();
    fireEvent.keyDown(body, { key: "]", code: "BracketRight", ...chord });
    expect(onFocus).toHaveBeenCalledWith("a");

    onFocus.mockClear();
    fireEvent.keyDown(document.body, { key: "]", code: "BracketRight", ...chord });
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("focuses issue tabs and closes them without focusing", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onClose = vi.fn();
    const titles = { [ISSUE_ID]: ISSUE_TITLE };
    const state = initialBotWorkspace(ISSUE_ID);
    const { rerender } = render(
      <BotTabs state={state} titles={titles} onFocus={onFocus} onClose={onClose} />,
    );

    const bot = screen.getByRole("button", { name: "Muse Bot" });
    expect(bot.className.split(/\s+/)).toContain("active");
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();

    rerender(
      <BotTabs
        state={openIssueSession(state, ISSUE_ID)}
        titles={titles}
        onFocus={onFocus}
        onClose={onClose}
      />,
    );

    const issue = screen.getByRole("button", { name: ISSUE_TITLE });
    expect(issue.className.split(/\s+/)).toContain("active");
    expect(screen.getByRole("button", { name: "Muse Bot" }).className.split(/\s+/)).not.toContain(
      "active",
    );
    expect(screen.getByRole("button", { name: "关闭" }).className.split(/\s+/)).not.toContain(
      "active",
    );
    expect(issue.querySelector(".bot-tab-label")?.textContent).toBe(ISSUE_TITLE);

    await user.click(issue);
    expect(onFocus).toHaveBeenCalledWith(ISSUE_ID);

    onFocus.mockClear();
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledWith(ISSUE_ID);
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe("bot workspace owner", () => {
  it("adopts the first issue when it arrives and does not reset open tabs", async () => {
    const { result, rerender } = renderHook(
      ({ issueId }: { issueId: string | null }) => useBotWorkspaceController(issueId),
      { initialProps: { issueId: null } },
    );
    expect(result.current.lastIssueId).toBeNull();
    expect(result.current.panel).toEqual({ kind: "none" });

    rerender({ issueId: ISSUE_ID });
    await waitFor(() => {
      expect(result.current.lastIssueId).toBe(ISSUE_ID);
    });
    expect(result.current.panel).toEqual({ kind: "issue", issueId: ISSUE_ID });
    expect(result.current.active).toBe("bot");
    expect(result.current.openIssueIds).toEqual([]);

    act(() => {
      result.current.openIssueSession(ISSUE_ID);
    });
    rerender({ issueId: "later" });
    expect(result.current.active).toBe(ISSUE_ID);
    expect(result.current.openIssueIds).toEqual([ISSUE_ID]);
    expect(result.current.panel).toEqual({ kind: "issue", issueId: ISSUE_ID });
  });
});

describe("assistant frame", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the empty prompt and keeps the assistant frame when the session id changes", async () => {
    resetWebviewStores();
    stubEmptyAssistant();
    render(
      <MuseTheme>
        <ShellSurfaceProvider value="assistant">
          <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
        </ShellSurfaceProvider>
      </MuseTheme>,
    );

    expect(await screen.findByText("今天想让我帮你做些什么？")).toBeInTheDocument();
    const frame = screen.getByTestId("assistant-frame");
    expect(within(frame).getByRole("button", { name: "Muse Bot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今天想让我帮你做些什么？" }).className).toContain(
      "welcome-headline",
    );

    establishSession({ sessionId: "sess-a" });
    establishSession({ sessionId: "sess-b" });

    expect(screen.getByTestId("assistant-frame")).toBeInTheDocument();
    expect(screen.getByText("今天想让我帮你做些什么？")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).toBeNull();
    expect(
      within(screen.getByTestId("assistant-frame")).getByRole("button", { name: "Muse Bot" }),
    ).toBeInTheDocument();
  });

  it("leaves the automations page when the session id changes on the no-pane rail", async () => {
    resetWebviewStores();
    stubEmptyAssistant();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    await user.click(screen.getByTestId("desktop-automations-menu"));
    expect(await screen.findByTestId("automations-page")).toBeInTheDocument();

    establishSession({ sessionId: "sess-next" });

    expect(screen.queryByTestId("automations-page")).toBeNull();
  });

  it("keeps the assistant frame when the session id changes with no shell provider", async () => {
    resetWebviewStores();
    stubEmptyAssistant();
    render(
      <MuseTheme>
        <ChatApp vscode={createMockVscode()} host={createMockDesktopHost()} />
      </MuseTheme>,
    );

    expect(await screen.findByTestId("assistant-frame")).toBeInTheDocument();
    establishSession({ sessionId: "sess-a" });
    expect(screen.getByTestId("assistant-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).toBeNull();
  });

  it("keeps the assistant frame when the session id changes while a split is open", async () => {
    resetWebviewStores();
    stubEmptyAssistant();
    const vscode = createMockVscode();
    const { rerender } = render(
      <MuseTheme>
        <ChatApp vscode={vscode} host={createMockDesktopHost()} />
      </MuseTheme>,
    );
    expect(await screen.findByTestId("assistant-frame")).toBeInTheDocument();

    rerender(
      <MuseTheme>
        <ChatApp
          vscode={vscode}
          host={createMockDesktopHost({
            panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
            focusedPaneId: "pane-1",
          })}
        />
      </MuseTheme>,
    );
    establishSession({ sessionId: "sess-split" });

    rerender(
      <MuseTheme>
        <ChatApp vscode={vscode} host={createMockDesktopHost()} />
      </MuseTheme>,
    );
    expect(screen.getByTestId("assistant-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).toBeNull();
  });

  it("shows issue tabs from the workspace passed into DesktopShell", async () => {
    resetWebviewStores();
    stubEmptyAssistant();
    const { result } = renderHook(() => useBotWorkspaceController(null));
    act(() => {
      result.current.openIssueSession(ISSUE_ID);
    });

    render(
      <MuseTheme>
        <DesktopShell
          workspace={result.current}
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
            focusedPaneId: "pane-1",
            issueGroups: [
              {
                issueId: ISSUE_ID,
                title: ISSUE_TITLE,
                priority: "p1",
                status: "pending",
                items: [],
                sessions: [],
              },
            ],
          })}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    expect(
      within(frame)
        .getAllByRole("button")
        .some((button) => button.textContent === ISSUE_TITLE),
    ).toBe(true);
  });

  it("shows Muse Bot tabs on the focused pane", async () => {
    resetWebviewStores();
    stubEmptyAssistant();
    render(
      <MuseTheme>
        <DesktopShell
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
            focusedPaneId: "pane-1",
            issueGroups: [
              {
                issueId: ISSUE_ID,
                title: ISSUE_TITLE,
                priority: "p1",
                status: "pending",
                items: [],
                sessions: [],
              },
            ],
          })}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    const frame = await screen.findByTestId("assistant-frame");
    expect(within(frame).getByRole("button", { name: "Muse Bot" })).toBeInTheDocument();
    expect(within(frame).queryByRole("button", { name: "关闭" })).toBeNull();
    expect(within(frame).getByText("今天想让我帮你做些什么？")).toBeInTheDocument();
  });
});
