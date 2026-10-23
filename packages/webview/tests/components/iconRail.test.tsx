/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { DesktopShell } from "../../src/components/desktop/DesktopShell";
import { MuseApiClient } from "../../src/muse/apiClient";
import { resetWebviewStores } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import type {
  DesktopHostProps,
  DesktopSessionEntry,
  VsCodeApi,
} from "../../src/types";
import { establishSession } from "../webview/test-utils";

function mockVscode(): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: () => ({}),
    setState: vi.fn(),
  };
}

function entry(sessionId: string): DesktopSessionEntry {
  return {
    sessionId,
    title: sessionId,
    lastActiveAt: Date.now(),
    workdir: "/tmp/proj",
    hasWorktree: false,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubSettingsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/settings/raw")) {
        return jsonResponse({ path: "/tmp/settings.json", content: "{}\n" });
      }
      if (url.includes("/scenarios/models")) {
        return jsonResponse({
          models: {
            session: "m",
            "issue-plan": "m",
            "issue-exec": "m",
            assistant: "m",
          },
        });
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
      if (url.includes("/settings/tavily")) {
        return jsonResponse({ configured: false, source: "none" });
      }
      if (url.includes("/assistant/messages")) {
        return jsonResponse({ messages: [], hasMore: false });
      }
      if (url.includes("/assistant/queue")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/automations")) {
        return jsonResponse({ automations: [] });
      }
      if (url.includes("/assistant/session")) {
        return jsonResponse({
          sessionId: "assistant",
          title: "Muse Bot",
          workdir: "/tmp/proj",
          working: false,
        });
      }
      return jsonResponse({});
    }),
  );
}

async function dirtySettingsDrafts(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole("tab", { name: "Agent" }));
  const editor = await screen.findByTestId("agent-settings-editor");
  await waitFor(() => {
    expect(editor).toHaveValue("{}\n");
  });
  fireEvent.change(editor, { target: { value: '{"token":"draft"}\n' } });

  await user.click(screen.getByRole("tab", { name: "供应商" }));
  const apiKey = await screen.findByPlaceholderText("请输入 API Key");
  fireEvent.change(apiKey, { target: { value: "sk-draft" } });
  return { editor, apiKey };
}

function hostWithPanes(): DesktopHostProps {
  return {
    type: "desktop",
    host: "local",
    workdir: "/tmp/proj",
    recentWorkdirs: ["/tmp/proj"],
    onSelectWorkdir: vi.fn(),
    onSelectRecentWorkdir: vi.fn(),
    onRemoveRecentWorkdir: vi.fn(),
    sessionTree: [
      {
        host: "local",
        workdir: "recent",
        sessions: [entry("sess-1")],
      },
    ],
    issueGroups: [
      {
        issueId: "issue-1",
        title: "侧栏 Issue",
        priority: "p2",
        type: "research",
        status: "pending",
        items: [],
        sessions: [entry("plan-1")],
      },
    ],
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onTogglePin: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenPane: vi.fn(),
    panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
    focusedPaneId: "pane-1",
  };
}

describe("desktop icon rail", () => {
  it("opens on Muse Bot and switches views from the rail", async () => {
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <DesktopShell
          vscode={mockVscode()}
          host={hostWithPanes()}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(screen.queryByTestId("desktop-brand")).toBeNull();

    const sessions = screen.getByTestId("desktop-sessions-menu");
    const automations = screen.getByTestId("desktop-automations-menu");
    const settings = screen.getByTestId("desktop-settings-btn");
    expect(sessions).toHaveAttribute("aria-label", "会话");
    expect(sessions).toHaveAttribute("title", "会话");
    expect(automations).toHaveAttribute("aria-label", "自动化");
    expect(automations).toHaveAttribute("title", "自动化");
    expect(settings).toHaveAttribute("aria-label", "设置");
    expect(settings).toHaveAttribute("title", "设置");

    await user.click(sessions);
    expect(screen.getByTestId("desktop-assistant-menu").className).not.toContain(
      "active",
    );
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
    expect(
      screen
        .getByTestId("desktop-session-list")
        .contains(screen.getByTestId("desktop-new-session")),
    ).toBe(true);

    await user.click(screen.getByTestId("desktop-assistant-menu"));
    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-session-list")).toBeNull();
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
  });

  it("lists ordinary sessions without issues and stays on sessions", async () => {
    const user = userEvent.setup();
    const host = hostWithPanes();
    render(
      <MuseTheme>
        <DesktopShell
          vscode={mockVscode()}
          host={host}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const list = screen.getByTestId("desktop-session-list");
    expect(list).toHaveTextContent("sess-1");
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();

    await user.click(screen.getByTestId("desktop-session-item-sess-1"));
    expect(host.onSelectSession).toHaveBeenCalledWith("/tmp/proj", "sess-1");
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
  });

  it("opens the no-pane desktop on Muse Bot and switches to sessions", async () => {
    resetWebviewStores();
    const user = userEvent.setup();
    const host = { ...hostWithPanes(), panes: [], focusedPaneId: null };
    render(
      <MuseTheme>
        <ChatApp vscode={mockVscode()} host={host} />
      </MuseTheme>,
    );
    establishSession();

    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(screen.queryByTestId("desktop-session-list")).toBeNull();
    expect(screen.queryByTestId("desktop-new-session")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();

    await user.click(screen.getByTestId("desktop-sessions-menu"));

    expect(screen.getByTestId("desktop-assistant-menu").className).not.toContain(
      "active",
    );
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
    const list = screen.getByTestId("desktop-session-list");
    expect(list).toHaveTextContent("sess-1");
    expect(list.contains(screen.getByTestId("desktop-new-session"))).toBe(true);
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();

    await user.click(screen.getByTestId("desktop-session-item-sess-1"));
    expect(host.onSelectSession).toHaveBeenCalledWith("/tmp/proj", "sess-1");
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
  });

  it("opens settings as a page without a dialog or the panel dock", async () => {
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <DesktopShell
          vscode={mockVscode()}
          host={hostWithPanes()}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByTestId("desktop-settings-btn"));

    const page = screen.getByTestId("desktop-settings-page");
    expect(page).toHaveTextContent("外观");
    expect(page).not.toHaveAttribute("role", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".configuration-dialog-overlay")).toBeNull();
    expect(screen.queryByTestId("desktop-panel-dock")).toBeNull();
    expect(screen.queryByTestId("config-dialog")).toBeNull();
  });

  it("puts the login button at the top of settings when signed out", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(
      <MuseTheme>
        <DesktopShell
          vscode={mockVscode()}
          host={hostWithPanes()}
          onLogin={onLogin}
          isAuthenticated={false}
          api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
          postToHost={vi.fn()}
        />
      </MuseTheme>,
    );

    await user.click(screen.getByTestId("desktop-settings-btn"));

    const page = screen.getByTestId("desktop-settings-page");
    const login = screen.getByTestId("desktop-login-btn");
    expect(page.contains(login)).toBe(true);
    const appearance = screen.getByRole("tab", { name: "外观" });
    expect(
      login.compareDocumentPosition(appearance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    await user.click(login);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("opens shell settings from showConfiguration without a dialog", () => {
    resetWebviewStores();
    render(
      <MuseTheme>
        <ChatApp vscode={mockVscode()} host={hostWithPanes()} />
      </MuseTheme>,
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "showConfiguration",
            configurationData: { language: "Chinese" },
          },
        }),
      );
    });

    expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("config-dialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("desktop-settings-btn").className).toContain(
      "active",
    );
  });

  it("opens shell settings from /config without a dialog", async () => {
    resetWebviewStores();
    const user = userEvent.setup();
    const vscode = mockVscode();
    render(
      <MuseTheme>
        <ChatApp vscode={vscode} host={hostWithPanes()} />
      </MuseTheme>,
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "authStatusResponse", isAuthenticated: true },
        }),
      );
    });

    await user.click(screen.getByTestId("desktop-sessions-menu"));
    const input = screen.getByTestId("message-input");
    vscode.postMessage.mockClear();
    act(() => {
      input.textContent = "/config";
    });
    fireEvent.input(input);
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getConfiguration" }),
    );
    expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("config-dialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps showConfiguration as a dialog off desktop", () => {
    resetWebviewStores();
    render(
      <MuseTheme>
        <ChatApp vscode={mockVscode()} />
      </MuseTheme>,
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "showConfiguration", configurationData: {} },
        }),
      );
    });
    expect(screen.getByTestId("config-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-settings-page")).toBeNull();
  });

  it("asks before leaving unsaved settings and ignores a repeat settings click", async () => {
    stubSettingsFetch();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      const user = userEvent.setup();
      render(
        <MuseTheme>
          <DesktopShell
            vscode={mockVscode()}
            host={hostWithPanes()}
            api={new MuseApiClient({ baseUrl: "http://127.0.0.1:9" })}
            postToHost={vi.fn()}
          />
        </MuseTheme>,
      );

      await user.click(screen.getByTestId("desktop-settings-btn"));
      const drafts = await dirtySettingsDrafts(user);

      confirm.mockClear();
      await user.click(screen.getByTestId("desktop-settings-btn"));
      expect(confirm).not.toHaveBeenCalled();
      expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();
      expect(drafts.editor).toHaveValue('{"token":"draft"}\n');

      await user.click(screen.getByTestId("desktop-assistant-menu"));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith("有未保存的修改，确定关闭？");
      expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();
      expect(drafts.editor).toHaveValue('{"token":"draft"}\n');

      confirm.mockClear();
      await user.click(screen.getByTestId("desktop-sessions-menu"));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();

      confirm.mockClear();
      await user.click(screen.getByTestId("desktop-automations-menu"));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();

      confirm.mockReturnValue(true);
      confirm.mockClear();
      await user.click(screen.getByTestId("desktop-automations-menu"));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("desktop-settings-page")).toBeNull();
      expect(screen.getByTestId("automations-page")).toBeInTheDocument();
    } finally {
      confirm.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("asks before the no-pane rail leaves unsaved settings", async () => {
    resetWebviewStores();
    stubSettingsFetch();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      const user = userEvent.setup();
      const host = { ...hostWithPanes(), panes: [], focusedPaneId: null };
      render(
        <MuseTheme>
          <ChatApp vscode={mockVscode()} host={host} />
        </MuseTheme>,
      );
      await user.click(screen.getByTestId("desktop-settings-btn"));
      const drafts = await dirtySettingsDrafts(user);

      await user.click(screen.getByTestId("desktop-assistant-menu"));
      expect(confirm).toHaveBeenCalledWith("有未保存的修改，确定关闭？");
      expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();
      expect(drafts.apiKey).toHaveValue("sk-draft");

      confirm.mockReturnValue(true);
      await user.click(screen.getByTestId("desktop-sessions-menu"));
      expect(screen.queryByTestId("desktop-settings-page")).toBeNull();
      expect(screen.getByTestId("desktop-session-list")).toBeInTheDocument();
    } finally {
      confirm.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
