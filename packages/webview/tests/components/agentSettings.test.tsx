/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { AgentSettings } from "../../src/components/settings/AgentSettings";
import { useScenarioModelsStore } from "../../src/stores/scenarioModelsStore";
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

/** AgentSettings 包含场景默认模型；mock 需补 agent 方法。 */
function baseApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getSettingsRaw: vi.fn().mockResolvedValue({
      path: "/tmp/.muse-work/settings.json",
      content: "{}\n",
    }),
    putSettingsRaw: vi.fn().mockResolvedValue({
      path: "/tmp/.muse-work/settings.json",
      content: "{}\n",
    }),
    getScenarioModels: vi.fn().mockResolvedValue({
      models: {
        session: "deepseek-v4-flash",
        popo: "deepseek-v4-flash",
        "issue-plan": "deepseek-v4-flash",
        "issue-exec": "deepseek-v4-flash",
      },
    }),
    putScenarioModels: vi.fn().mockResolvedValue({
      models: {
        session: "deepseek-v4-flash",
        popo: "deepseek-v4-flash",
        "issue-plan": "deepseek-v4-flash",
        "issue-exec": "deepseek-v4-flash",
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

  it("loads ~/.muse-work settings text and blocks save on invalid JSON", async () => {
    const api = {
      ...baseApi(),
      getSettingsRaw: vi.fn().mockResolvedValue({
        path: "/tmp/.muse-work/settings.json",
        content: '{\n  "env": {}\n}\n',
      }),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-settings-editor")).toHaveValue(
        '{\n  "env": {}\n}\n',
      );
    });
    expect(screen.getByText(/\/tmp\/\.muse-work\/settings\.json/)).toBeInTheDocument();

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
        path: "/tmp/.muse-work/settings.json",
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

  it("renders scenario default model pickers", async () => {
    const api = {
      ...baseApi(),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("scenario-model-session")).toBeInTheDocument();
    });
    expect(screen.getByText("场景默认模型")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-model-popo")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-model-issue-plan")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-model-issue-exec")).toBeInTheDocument();
  });

  it("saves scenario default models via PUT /scenarios/models", async () => {
    const putScenarioModels = vi.fn().mockResolvedValue({
      models: {
        session: "m2",
        popo: "deepseek-v4-flash",
        "issue-plan": "deepseek-v4-flash",
        "issue-exec": "deepseek-v4-flash",
      },
    });
    const api = {
      ...baseApi(),
      putScenarioModels,
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
      expect(screen.getByTestId("scenario-model-session")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("scenario-model-session"));
    await user.click(await screen.findByRole("option", { name: "M2" }));

    const ok = await ref.current!.save();
    expect(ok).toBe(true);
    expect(putScenarioModels).toHaveBeenCalled();
    const payload = putScenarioModels.mock.calls[0][0] as {
      models: { session: string };
    };
    expect(payload.models.session).toBe("m2");
  });

  it("refreshes scenarioModelsStore after saving scenario default models", async () => {
    const refresh = vi
      .spyOn(useScenarioModelsStore.getState(), "refresh")
      .mockResolvedValue(undefined);
    const api = baseApi();

    const ref = React.createRef<{
      save: () => Promise<boolean>;
      isDirty: () => boolean;
    }>();
    render(
      <Theme>
        <AgentSettings api={api as unknown as MuseApiClient} ref={ref} />
      </Theme>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("scenario-model-session")).toBeInTheDocument();
    });
    await ref.current!.save();
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });
});
