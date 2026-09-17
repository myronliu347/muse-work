/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopSidebar } from "../../src/components/desktop/DesktopSidebar";
import { AutomationsPage } from "../../src/components/automation/AutomationsPage";
import type { MuseApiClient } from "../../src/muse/apiClient";
import { renderChatApp } from "../webview/test-utils";
import { MuseTheme } from "../../src/ui/theme";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SAMPLE = {
  id: "auto-1",
  name: "工作日 changelog 巡检",
  description: "",
  enabled: false,
  prompt: "检查 changelog",
  workdir: "/work/muse",
  permission: "workspace" as const,
  triggers: [{ type: "cron" as const, expr: "0 9 * * 1-5" }],
  createdAt: 1,
  updatedAt: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

function stubFetch(automations = [SAMPLE]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/automations") && method === "GET" && !url.includes("/runs")) {
      if (/\/automations\/[^/]+$/.test(url) && !url.endsWith("/automations")) {
        return jsonResponse({ automation: automations[0] });
      }
      return jsonResponse({ automations });
    }
    if (url.endsWith("/automations") && method === "POST") {
      return jsonResponse(
        {
          automation: {
            ...SAMPLE,
            id: "draft-1",
            name: "",
            enabled: false,
            prompt: "",
            workdir: "",
            triggers: [],
          },
        },
        201,
      );
    }
    if (url.includes("/automations/") && method === "PATCH") {
      return jsonResponse({ automation: SAMPLE });
    }
    if (url.includes("/agents/scenarios")) {
      return jsonResponse({ scenarios: { session: "default" } });
    }
    if (url.includes("/agents")) {
      return jsonResponse({ version: 1, agents: [] });
    }
    if (url.includes("/popo/config")) {
      return jsonResponse({
        url: "",
        token: "",
        aesKey: "",
        masterUid: "",
        port: 0,
        ready: false,
        configured: false,
        error: null,
      });
    }
    if (url.includes("/providers")) {
      return jsonResponse({ providers: [], active: { providerId: "x" } });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sidebarNoop = {
  onNewSession: () => {},
  onNewSessionInPane: () => {},
  isStreaming: false,
  disabled: false,
  onOpenSettings: () => {},
  sessionTree: [] as never[],
  pinnedSessions: [] as never[],
  recentSessions: [] as never[],
  onSelectSession: () => {},
  onOpenPane: () => {},
  onDeleteSession: () => {},
  onTogglePin: () => {},
};

function mockApi(overrides: Partial<MuseApiClient> = {}): MuseApiClient {
  return {
    listAutomations: vi.fn().mockResolvedValue({ automations: [SAMPLE] }),
    createAutomation: vi.fn().mockResolvedValue({
      automation: { ...SAMPLE, id: "draft-1", name: "", prompt: "", workdir: "", triggers: [], enabled: false },
    }),
    patchAutomation: vi.fn().mockResolvedValue({ automation: SAMPLE }),
    enableAutomation: vi.fn().mockResolvedValue({ automation: { ...SAMPLE, enabled: true } }),
    disableAutomation: vi.fn().mockResolvedValue({ automation: SAMPLE }),
    deleteAutomation: vi.fn().mockResolvedValue({ ok: true }),
    runAutomation: vi.fn().mockResolvedValue({ run: { id: "r1" } }),
    listAutomationRuns: vi.fn().mockResolvedValue({ runs: [] }),
    stopAutomationRun: vi.fn().mockResolvedValue({ ok: true }),
    getSession: vi.fn().mockResolvedValue({ id: "s1" }),
    getMessages: vi.fn().mockResolvedValue({ messages: [] }),
    listProviders: vi.fn().mockResolvedValue({
      providers: [],
      active: { providerId: "x" },
    }),
    ...overrides,
  } as unknown as MuseApiClient;
}

describe("automations dedicated page", () => {
  beforeEach(() => {
    stubFetch();
  });

  it("sidebar app-menu has 自动化 and session tree does not list rules", () => {
    const onOpenAutomations = vi.fn();
    render(
      <DesktopSidebar
        {...sidebarNoop}
        onOpenAutomations={onOpenAutomations}
        recentSessions={[
          {
            sessionId: "sess-1",
            title: "普通会话",
            lastActiveAt: Date.now(),
            hasWorktree: false,
            workdir: "/work/demo",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("desktop-automations-menu")).toHaveTextContent("自动化");
    expect(screen.queryByText("工作日 changelog 巡检")).toBeNull();
    expect(screen.getByText("普通会话")).toBeInTheDocument();
    expect(
      screen.queryByTestId("desktop-session-section-automations"),
    ).toBeNull();
  });

  it("clicking 自动化 replaces the chat column with the list page", async () => {
    const user = userEvent.setup();
    renderChatApp();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    await user.click(screen.getByTestId("desktop-automations-menu"));
    expect(await screen.findByTestId("automations-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).toBeNull();
    expect(screen.getByTestId("automations-page").closest(".desktop-layout")).not.toBeNull();
    expect(await screen.findByText("工作日 changelog 巡检")).toBeInTheDocument();
    expect(screen.getByTestId("automations-wallpaper")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-automations-menu").className).toContain(
      "active",
    );
  });

  it("editor has 添加触发器, no cron textbox, and run is disabled when off", async () => {
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <AutomationsPage
          api={mockApi()}
          postToHost={() => {}}
          recentWorkdirs={["/work/muse"]}
        />
      </MuseTheme>,
    );
    expect(await screen.findByText("工作日 changelog 巡检")).toBeInTheDocument();
    await user.click(screen.getByText("工作日 changelog 巡检"));
    expect(await screen.findByTestId("automation-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加触发器/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /cron/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/cron/i)).toBeNull();
    const cronInputs = screen.queryAllByDisplayValue(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/);
    expect(cronInputs).toHaveLength(0);
    expect(screen.getByTestId("automation-run-now")).toBeDisabled();
    expect(screen.getByTestId("automation-run-now")).toHaveTextContent("测试");
    expect(screen.getByTestId("automation-save")).toBeDisabled();
    expect(screen.getByRole("navigation", { name: "面包屑" })).toHaveTextContent(
      "自动化",
    );
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.getByTestId("automation-workdir")).toHaveTextContent("muse");
    await user.click(screen.getByTestId("automation-workdir"));
    expect(screen.getByTestId("desktop-workdir-menu")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-workdir-browse")).toHaveTextContent("浏览…");
    await user.click(screen.getByPlaceholderText(/输入指令/));
    await user.keyboard("更新 changelog");
    expect(screen.getByTestId("automation-save")).not.toBeDisabled();
  });

  it("empty list shows a centered create prompt", async () => {
    render(
      <MuseTheme>
        <AutomationsPage
          api={mockApi({
            listAutomations: vi.fn().mockResolvedValue({ automations: [] }),
          })}
          postToHost={() => {}}
          recentWorkdirs={["/work/muse"]}
        />
      </MuseTheme>,
    );
    const empty = await screen.findByTestId("automations-empty");
    expect(empty).toHaveTextContent("还没有自动化");
    expect(empty).toHaveTextContent("新建自动化");
    expect(empty.querySelector(".automations-empty-preview")).not.toBeNull();
    expect(screen.getByTestId("automations-wallpaper")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "新建自动化" }),
    ).toHaveLength(1);
  });

  it("新建 opens an unsaved editor and does not POST until 保存", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      listAutomations: vi.fn().mockResolvedValue({ automations: [] }),
    });
    render(
      <MuseTheme>
        <AutomationsPage
          api={api}
          postToHost={() => {}}
          recentWorkdirs={["/work/muse"]}
        />
      </MuseTheme>,
    );
    await user.click(await screen.findByRole("button", { name: "新建自动化" }));
    expect(await screen.findByTestId("automation-editor")).toBeInTheDocument();
    expect(api.createAutomation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "自动化" }));
    expect(await screen.findByTestId("automations-empty")).toBeInTheDocument();
    expect(api.createAutomation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "新建自动化" }));
    await user.click(await screen.findByPlaceholderText(/输入指令/));
    await user.keyboard("每天巡检");
    await user.click(screen.getByTestId("automation-save"));
    await waitFor(() => {
      expect(api.createAutomation).toHaveBeenCalledTimes(1);
    });
    expect(api.patchAutomation).not.toHaveBeenCalled();
  });
});
