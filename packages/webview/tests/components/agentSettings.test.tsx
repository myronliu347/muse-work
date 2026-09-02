/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { AgentSettings } from "../../src/components/settings/AgentSettings";
import { useAgentsStore } from "../../src/stores/agentsStore";
import type { MuseApiClient } from "../../src/muse/apiClient";

// radix Select / portal 依赖的指针捕获方法，jsdom 未实现（参考 museProviderSettings.test.tsx）
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

function renderAgent(api: MuseApiClient) {
  return render(
    <Theme>
      <AgentSettings api={api} />
    </Theme>,
  );
}

/** AgentSettings 现在包含 AgentManager（数字人 agent + 场景映射），mock 需补 agent 方法。 */
function baseApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getSettingsRaw: vi.fn().mockResolvedValue({
      path: "/tmp/.wave/settings.json",
      content: "{}\n",
    }),
    putSettingsRaw: vi.fn().mockResolvedValue({
      path: "/tmp/.wave/settings.json",
      content: "{}\n",
    }),
    getAgents: vi.fn().mockResolvedValue({ version: 1, agents: [] }),
    getAgentScenarios: vi
      .fn()
      .mockResolvedValue({
        scenarios: {
          session: "default",
          popo: "popo",
          "issue-plan": "plan",
          "issue-exec": "execute",
        },
      }),
    putAgents: vi.fn().mockResolvedValue({ version: 1, agents: [] }),
    putAgentScenarios: vi.fn().mockResolvedValue({
      scenarios: {
        session: "default",
        popo: "popo",
        "issue-plan": "plan",
        "issue-exec": "execute",
      },
    }),
    // MuseModelSelect 挂载时拉取 providers
    listProviders: vi.fn().mockResolvedValue({
      providers: [
        {
          id: "codemaker",
          displayName: "CodeMaker",
          models: [
            { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
            { id: "m2", label: "M2" },
          ],
        },
      ],
      active: { providerId: "codemaker", modelId: "deepseek-v4-flash" },
    }),
  };
}

describe("AgentSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 还原 refresh 为原始实现，避免跨测试污染（zustand store 模块级单例）
    vi.restoreAllMocks();
  });

  it("loads ~/.wave settings text and blocks save on invalid JSON", async () => {
    const api = {
      ...baseApi(),
      getSettingsRaw: vi.fn().mockResolvedValue({
        path: "/tmp/.wave/settings.json",
        content: '{\n  "env": {}\n}\n',
      }),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-settings-editor")).toHaveValue(
        '{\n  "env": {}\n}\n',
      );
    });
    expect(screen.getByText(/\/tmp\/\.wave\/settings\.json/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("agent-settings-editor"), {
      target: { value: "{" },
    });
    expect(screen.getByText("JSON 格式无效")).toBeInTheDocument();
    expect(api.putSettingsRaw).not.toHaveBeenCalled();
  });

  it("saves valid JSON via putSettingsRaw", async () => {
    const api = {
      ...baseApi(),
      putSettingsRaw: vi.fn().mockResolvedValue({
        path: "/tmp/.wave/settings.json",
        content: '{\n  "env": {\n    "A": "1"\n  }\n}\n',
      }),
    } as unknown as MuseApiClient;

    const ref = React.createRef<{
      save: () => Promise<boolean>;
      isDirty: () => boolean;
    }>();
    render(
      <Theme>
        <AgentSettings api={api} ref={ref} />
      </Theme>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("agent-settings-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("agent-settings-editor"), {
      target: { value: '{"env":{"A":"1"}}' },
    });
    const ok = await ref.current!.save();
    expect(ok).toBe(true);
    expect(api.putSettingsRaw).toHaveBeenCalledWith('{"env":{"A":"1"}}');
  });

  it("renders the digital-agent manager (list + scenarios)", async () => {
    const api = {
      ...baseApi(),
      getAgents: vi.fn().mockResolvedValue({
        version: 1,
        agents: [
          {
            key: "default",
            name: "Muse",
            personality: "professional",
            systemPrompt: "",
            model: "deepseek-v4-flash",
            fastModel: "",
            tools: [],
            permission: [],
          },
          {
            key: "xiaomei",
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "请用中文回复",
            model: "m2",
            fastModel: "",
            tools: [],
            permission: [],
          },
        ],
      }),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-manager-list")).toBeInTheDocument();
    });
    expect(screen.getByText("数字人 Agent")).toBeInTheDocument();
    expect(screen.getByText("小美")).toBeInTheDocument();
    expect(screen.getByText("Muse")).toBeInTheDocument();
    // 场景映射 4 行
    expect(screen.getByTestId("scenario-session")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-popo")).toBeInTheDocument();
    // 内置 agent 无删除按钮，自定义有
    expect(screen.queryByTestId("agent-delete-default")).toBeNull();
    expect(screen.getByTestId("agent-delete-xiaomei")).toBeInTheDocument();
  });

  it("edits an agent and saves via PUT /agents", async () => {
    const putAgents = vi.fn().mockResolvedValue({
      version: 1,
      agents: [
        {
          key: "xiaomei",
          name: "小美新",
          personality: "concise",
          systemPrompt: "请用中文回复",
          model: "m2",
          fastModel: "",
          tools: [],
          permission: [],
        },
      ],
    });
    const api = {
      ...baseApi(),
      getAgents: vi.fn().mockResolvedValue({
        version: 1,
        agents: [
          {
            key: "xiaomei",
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "",
            model: "m2",
            fastModel: "",
            tools: [],
            permission: [],
          },
        ],
      }),
      putAgents,
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-edit-xiaomei")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("agent-edit-xiaomei"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-form")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("agent-form-name"), {
      target: { value: "小美新" },
    });
    // personality 改为 radix Select：打开下拉并点选「简洁干练」（concise）
    const user = userEvent.setup();
    await user.click(screen.getByTestId("agent-form-personality"));
    await user.click(await screen.findByRole("option", { name: /简洁干练/ }));
    fireEvent.click(screen.getByTestId("agent-form-save"));
    await waitFor(() => {
      expect(putAgents).toHaveBeenCalled();
    });
    const payload = putAgents.mock.calls[0][0] as {
      agents: Record<string, { name: string; personality: string }>;
    };
    expect(payload.agents.xiaomei.name).toBe("小美新");
    expect(payload.agents.xiaomei.personality).toBe("concise");
  });

  it("renders model/fastModel as dropdowns bound to provider models", async () => {
    const api = baseApi();
    api.getAgents = vi.fn().mockResolvedValue({
      version: 1,
      agents: [
        {
          key: "xiaomei",
          name: "小美",
          personality: "warm-patient",
          systemPrompt: "",
          model: "m2",
          fastModel: "",
          tools: [],
          permission: [],
        },
      ],
    });
    renderAgent(api as unknown as MuseApiClient);
    await waitFor(() => {
      expect(screen.getByTestId("agent-edit-xiaomei")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("agent-edit-xiaomei"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-form")).toBeInTheDocument();
    });
    // model / fastModel 现在是 Radix 下拉（MuseModelSelect），trigger 显示模型 label
    await waitFor(() => {
      expect(screen.getByTestId("agent-form-model")).toHaveTextContent("M2");
    });
    // fastModel 留空 → 显示（留空）选项
    expect(screen.getByTestId("agent-form-fastModel")).toHaveTextContent("（留空）");
  });

  it("renders the edit form in a grouped Dialog and closes it after save", async () => {
    const putAgents = vi.fn().mockResolvedValue({
      version: 1,
      agents: [
        {
          key: "xiaomei",
          name: "小美",
          personality: "warm-patient",
          systemPrompt: "",
          model: "m2",
          fastModel: "",
          tools: [],
          permission: [],
        },
      ],
    });
    const api = {
      ...baseApi(),
      getAgents: vi.fn().mockResolvedValue({
        version: 1,
        agents: [
          {
            key: "xiaomei",
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "",
            model: "m2",
            fastModel: "",
            tools: [],
            permission: [],
          },
        ],
      }),
      putAgents,
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-edit-xiaomei")).toBeInTheDocument();
    });
    // 初始：无 Dialog（表单不展开）
    expect(screen.queryByTestId("agent-form")).toBeNull();

    fireEvent.click(screen.getByTestId("agent-edit-xiaomei"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-form")).toBeInTheDocument();
    });
    // 分组成段的小标题
    expect(screen.getByText("基础信息")).toBeInTheDocument();
    expect(screen.getByText("模型")).toBeInTheDocument();
    expect(screen.getByText("工具与权限")).toBeInTheDocument();
    expect(screen.getByText("系统提示")).toBeInTheDocument();
    // Dialog 标题
    expect(screen.getByText("编辑 Agent：小美")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agent-form-save"));
    await waitFor(() => {
      expect(putAgents).toHaveBeenCalled();
    });
    // 保存成功后 Dialog 关闭
    await waitFor(() => {
      expect(screen.queryByTestId("agent-form")).toBeNull();
    });
  });

  it("refreshes agentsStore after saving an agent (AgentSelector 即时更新)", async () => {
    const refresh = vi
      .spyOn(useAgentsStore.getState(), "refresh")
      .mockResolvedValue(undefined);
    const api = {
      ...baseApi(),
      getAgents: vi.fn().mockResolvedValue({
        version: 1,
        agents: [
          {
            key: "xiaomei",
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "",
            model: "m2",
            fastModel: "",
            tools: [],
            permission: [],
          },
        ],
      }),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-edit-xiaomei")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("agent-edit-xiaomei"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-form")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("agent-form-name"), {
      target: { value: "小美新" },
    });
    fireEvent.click(screen.getByTestId("agent-form-save"));
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("refreshes agentsStore after deleting an agent", async () => {
    const refresh = vi
      .spyOn(useAgentsStore.getState(), "refresh")
      .mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = {
      ...baseApi(),
      getAgents: vi.fn().mockResolvedValue({
        version: 1,
        agents: [
          {
            key: "xiaomei",
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "",
            model: "m2",
            fastModel: "",
            tools: [],
            permission: [],
          },
        ],
      }),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-delete-xiaomei")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("agent-delete-xiaomei"));
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
  });

  it("refreshes agentsStore after saving scenario mapping", async () => {
    const refresh = vi
      .spyOn(useAgentsStore.getState(), "refresh")
      .mockResolvedValue(undefined);
    const api = baseApi();
    api.getAgents = vi.fn().mockResolvedValue({
      version: 1,
      agents: [
        {
          key: "default",
          name: "Muse",
          personality: "professional",
          systemPrompt: "",
          model: "deepseek-v4-flash",
          fastModel: "",
          tools: [],
          permission: [],
        },
        {
          key: "plan",
          name: "规划",
          personality: "rational",
          systemPrompt: "",
          model: "deepseek-v4-flash",
          fastModel: "",
          tools: [],
          permission: [],
        },
      ],
    });
    renderAgent(api as unknown as MuseApiClient);
    await waitFor(() => {
      expect(screen.getByTestId("scenarios-save-btn")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("scenarios-save-btn"));
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("keeps the edit Dialog open when mousedown inside it while mounted in a .configuration-dialog (portal into settings overlay)", async () => {
    const api = baseApi();
    api.getAgents = vi.fn().mockResolvedValue({
      version: 1,
      agents: [
        {
          key: "xiaomei",
          name: "小美",
          personality: "warm-patient",
          systemPrompt: "",
          model: "m2",
          fastModel: "",
          tools: [],
          permission: [],
        },
      ],
    });

    // 模拟 ConfigDialog 的 document mousedown：点击不在设置弹窗内 → requestClose（onCancel）
    const containerRef = React.createRef<HTMLDivElement>();
    const onCancel = vi.fn();
    const handleClickOutside = (event: MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(event.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", handleClickOutside);

    render(
      <div className="configuration-dialog" ref={containerRef}>
        <Theme>
          <AgentSettings api={api as unknown as MuseApiClient} />
        </Theme>
      </div>,
    );

    try {
      await waitFor(() => {
        expect(screen.getByTestId("agent-edit-xiaomei")).toBeInTheDocument();
      });

      // 打开编辑 Dialog
      fireEvent.click(screen.getByTestId("agent-edit-xiaomei"));
      await waitFor(() => {
        expect(screen.getByTestId("agent-form")).toBeInTheDocument();
      });

      // Dialog 内容（portal 到 .configuration-dialog 内）上的 mousedown 不应触发关闭
      fireEvent.mouseDown(screen.getByTestId("agent-form-name"));
      expect(onCancel).not.toHaveBeenCalled();

      // 设置弹窗之外的 mousedown 仍应触发关闭（验证 handler 本身有效）
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(onCancel).toHaveBeenCalledTimes(1);
      document.body.removeChild(outside);
    } finally {
      document.removeEventListener("mousedown", handleClickOutside);
    }
  });
});
