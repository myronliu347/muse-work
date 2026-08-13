/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MuseProviderSettings,
  type MuseProviderSettingsHandle,
} from "../../src/components/MuseProviderSettings";
import type { MuseApiClient } from "../../src/muse/apiClient";
import { MUSE_PROVIDERS_CHANGED_EVENT } from "../../src/muse/providersEvents";
import { MuseTheme } from "../../src/ui/theme";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
});

function createApi(overrides?: Partial<MuseApiClient>): MuseApiClient {
  const api = {
    listProviders: vi.fn(async () => ({
      providers: [
        {
          id: "codemaker",
          displayName: "CodeMaker",
          models: [{ id: "m1", label: "M1" }],
        },
        {
          id: "openai-compatible",
          displayName: "OpenAI Compatible",
          models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
        },
      ],
      active: { providerId: "codemaker", modelId: "m1" },
    })),
    setActive: vi.fn(async (providerId: string, modelId: string) => ({
      ok: true as const,
      active: { providerId, modelId },
    })),
    getCodeMakerQuota: vi.fn(async () => ({
      raw: {
        data: {
          current_month: {
            usage_cost: 3.73,
            remaining: 4996.29,
            percentage: 0.07,
          },
        },
      },
      total: 5000.02,
      used: 3.73,
      remaining: 4996.29,
      percentage: 0.07,
      user: "alice",
    })),
    getOpenAiCompatibleConfig: vi.fn(async () => ({
      baseURL: "https://api.example.com/v1",
      apiKeyEnv: "MUSE_OPENAI_API_KEY",
      hasApiKey: true,
      hasStoredApiKey: false,
      models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
    })),
    updateOpenAiCompatibleConfig: vi.fn(async () => ({
      ok: true as const,
      active: { providerId: "openai-compatible", modelId: "gpt-4.1" },
    })),
    ...overrides,
  };
  return api as unknown as MuseApiClient;
}

function renderProviderSettings(
  props: React.ComponentProps<typeof MuseProviderSettings>,
) {
  return render(
    <MuseTheme>
      <MuseProviderSettings {...props} />
    </MuseTheme>,
  );
}

describe("MuseProviderSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows CodeMaker quota for the active provider", async () => {
    const api = createApi();
    renderProviderSettings({ api });

    await waitFor(() => {
      expect(screen.getByTestId("muse-codemaker-quota")).toBeTruthy();
      expect(screen.getByTestId("muse-quota-progress")).toBeTruthy();
    });
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("￥3.73")).toBeTruthy();
    expect(
      screen.getByText((text) => text.replace(/,/g, "") === "￥4996.29"),
    ).toBeTruthy();
    expect(screen.getByText("0.07%")).toBeTruthy();
  });

  it("keeps provider switch as draft until save, using draft model ids", async () => {
    const api = createApi();
    const ref = createRef<MuseProviderSettingsHandle>();
    const changed = vi.fn();
    const user = userEvent.setup();
    window.addEventListener(MUSE_PROVIDERS_CHANGED_EVENT, changed);

    renderProviderSettings({ ref, api });

    await waitFor(() => {
      expect(screen.getByLabelText("AI 供应商 (Provider)")).toBeTruthy();
    });

    await user.click(screen.getByLabelText("AI 供应商 (Provider)"));
    await user.click(
      await screen.findByRole("option", { name: "OpenAI Compatible" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("muse-openai-form")).toBeTruthy();
    });
    expect(api.setActive).not.toHaveBeenCalled();
    expect(ref.current!.isDirty()).toBe(true);

    fireEvent.change(screen.getByLabelText("API URL"), {
      target: { value: "https://new.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-new" },
    });
    fireEvent.change(screen.getByLabelText("支持的 Model 列表"), {
      target: { value: "only-a|Only A\nonly-b|Only B" },
    });

    const ok = await ref.current!.save();
    expect(ok).toBe(true);

    await waitFor(() => {
      expect(api.updateOpenAiCompatibleConfig).toHaveBeenCalledWith({
        baseURL: "https://new.example.com/v1",
        apiKey: "sk-new",
        models: [
          { id: "only-a", label: "Only A" },
          { id: "only-b", label: "Only B" },
        ],
      });
      // Must not keep the stale gpt-4.1 from the pre-edit provider list.
      expect(api.setActive).toHaveBeenCalledWith(
        "openai-compatible",
        "only-a",
      );
      expect(changed).toHaveBeenCalled();
    });

    window.removeEventListener(MUSE_PROVIDERS_CHANGED_EVENT, changed);
  });

  it("falls back to deepseek-v4-flash when switching to CodeMaker without matching active", async () => {
    const api = createApi({
      listProviders: vi.fn(async () => ({
        providers: [
          {
            id: "codemaker",
            displayName: "CodeMaker",
            models: [
              { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
              { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
            ],
          },
          {
            id: "openai-compatible",
            displayName: "OpenAI Compatible",
            models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
          },
        ],
        active: { providerId: "openai-compatible", modelId: "gpt-4.1" },
      })),
      getOpenAiCompatibleConfig: vi.fn(async () => ({
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "MUSE_OPENAI_API_KEY",
        hasApiKey: true,
        hasStoredApiKey: false,
        models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
      })),
    });
    const ref = createRef<MuseProviderSettingsHandle>();
    const user = userEvent.setup();

    renderProviderSettings({ ref, api });

    await waitFor(() => {
      expect(screen.getByLabelText("AI 供应商 (Provider)")).toBeTruthy();
    });

    await user.click(screen.getByLabelText("AI 供应商 (Provider)"));
    await user.click(await screen.findByRole("option", { name: "CodeMaker" }));

    const ok = await ref.current!.save();
    expect(ok).toBe(true);
    expect(api.setActive).toHaveBeenCalledWith(
      "codemaker",
      "deepseek-v4-flash",
    );
  });
});
