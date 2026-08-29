/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { AgentSettings } from "../../src/components/settings/AgentSettings";
import type { MuseApiClient } from "../../src/muse/apiClient";

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
          todo: "plan",
          task: "execute",
          popo: "popo",
        },
      }),
    putAgents: vi.fn().mockResolvedValue({ version: 1, agents: [] }),
    putAgentScenarios: vi.fn().mockResolvedValue({
      scenarios: {
        session: "default",
        todo: "plan",
        task: "execute",
        popo: "popo",
      },
    }),
  };
}

describe("AgentSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    fireEvent.change(screen.getByTestId("agent-form-personality"), {
      target: { value: "concise" },
    });
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
});
