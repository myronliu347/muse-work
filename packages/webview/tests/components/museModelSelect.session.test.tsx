/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MuseModelSelect } from "../../src/components/MuseModelSelect";
import { MessageInput } from "../../src/components/MessageInput";
import type { MuseApiClient } from "../../src/muse/apiClient";

vi.mock("../../src/styles/MessageInput.css", () => ({}));

afterEach(() => {
  cleanup();
});

const providersBody = {
  providers: [
    {
      id: "codemaker",
      displayName: "CodeMaker",
      models: [
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      ],
    },
  ],
  active: { providerId: "codemaker", modelId: "deepseek-v4-pro" },
};

function stubProvidersApi(
  overrides: Partial<MuseApiClient> = {},
): MuseApiClient {
  return {
    listProviders: vi.fn(async () => providersBody),
    setActive: vi.fn(async () => ({
      ok: true as const,
      active: { providerId: "codemaker", modelId: "deepseek-v4-flash" },
    })),
    ...overrides,
  } as unknown as MuseApiClient;
}

describe("MuseModelSelect controlled session mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses modelId prop and calls onModelChange without setActive", async () => {
    const api = stubProvidersApi();
    const onModelChange = vi.fn();

    render(
      <MuseModelSelect
        api={api}
        modelId="deepseek-v4-flash"
        onModelChange={onModelChange}
      />,
    );

    const select = await screen.findByTestId("muse-model-select");
    expect(select).toHaveValue("deepseek-v4-flash");

    fireEvent.pointerDown(select);
    fireEvent.change(select, { target: { value: "deepseek-v4-pro" } });

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-pro");
    });
    expect(api.setActive).not.toHaveBeenCalled();
  });

  it("defaults to deepseek-v4-flash in session mode even if global active is opus", async () => {
    const api = stubProvidersApi({
      listProviders: vi.fn(async () => ({
        ...providersBody,
        providers: [
          {
            ...providersBody.providers[0],
            models: [
              { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
              { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
            ],
          },
        ],
        active: { providerId: "codemaker", modelId: "claude-opus-4-6" },
      })),
    });

    render(<MuseModelSelect api={api} onModelChange={() => {}} />);

    const select = await screen.findByTestId("muse-model-select");
    expect(select).toHaveValue("deepseek-v4-flash");
  });

  it("ignores a browser auto-select of models[0] when the option list first loads", async () => {
    const onModelChange = vi.fn();
    const api = stubProvidersApi({
      listProviders: vi.fn(async () => ({
        ...providersBody,
        providers: [
          {
            ...providersBody.providers[0],
            models: [
              { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
              { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
            ],
          },
        ],
        active: { providerId: "codemaker", modelId: "deepseek-v4-flash" },
      })),
    });

    render(<MuseModelSelect api={api} onModelChange={onModelChange} />);

    const select = await screen.findByTestId("muse-model-select");
    expect(select).toHaveValue("deepseek-v4-flash");

    // Chromium fires change with the first <option> when the list replaces
    // the loading placeholder — that is not a user pick.
    fireEvent.change(select, { target: { value: "claude-opus-4-6" } });

    expect(onModelChange).not.toHaveBeenCalled();
    expect(select).toHaveValue("deepseek-v4-flash");
  });

  it("still commits a user pick after pointerdown", async () => {
    const onModelChange = vi.fn();
    const api = stubProvidersApi({
      listProviders: vi.fn(async () => ({
        ...providersBody,
        providers: [
          {
            ...providersBody.providers[0],
            models: [
              { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
              { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
            ],
          },
        ],
        active: { providerId: "codemaker", modelId: "deepseek-v4-flash" },
      })),
    });

    render(
      <MuseModelSelect
        api={api}
        modelId="deepseek-v4-flash"
        onModelChange={onModelChange}
      />,
    );

    const select = await screen.findByTestId("muse-model-select");
    fireEvent.pointerDown(select);
    fireEvent.change(select, { target: { value: "claude-opus-4-6" } });

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith("claude-opus-4-6");
    });
  });

  it("does not treat a dismissed open as a later auto-select", async () => {
    const onModelChange = vi.fn();
    const api = stubProvidersApi({
      listProviders: vi.fn(async () => ({
        ...providersBody,
        providers: [
          {
            ...providersBody.providers[0],
            models: [
              { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
              { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
            ],
          },
        ],
        active: { providerId: "codemaker", modelId: "deepseek-v4-flash" },
      })),
    });

    render(
      <MuseModelSelect
        api={api}
        modelId="deepseek-v4-flash"
        onModelChange={onModelChange}
      />,
    );

    const select = await screen.findByTestId("muse-model-select");
    fireEvent.pointerDown(select);
    fireEvent.blur(select);
    fireEvent.change(select, { target: { value: "claude-opus-4-6" } });

    expect(onModelChange).not.toHaveBeenCalled();
    expect(select).toHaveValue("deepseek-v4-flash");
  });

  it("syncGlobalActive still posts providers/active", async () => {
    const api = stubProvidersApi();
    const onModelChange = vi.fn();

    render(
      <MuseModelSelect
        api={api}
        modelId="deepseek-v4-pro"
        onModelChange={onModelChange}
        syncGlobalActive
      />,
    );

    const select = await screen.findByTestId("muse-model-select");
    fireEvent.pointerDown(select);
    fireEvent.change(select, { target: { value: "deepseek-v4-flash" } });

    await waitFor(() => {
      expect(api.setActive).toHaveBeenCalledWith(
        "codemaker",
        "deepseek-v4-flash",
      );
    });
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
  });
});

describe("MessageInput session model select", () => {
  it("MessageInput renders model select bound to session model", async () => {
    const api = stubProvidersApi();
    const onModelChange = vi.fn();
    const vscode = {
      postMessage: vi.fn(),
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
    };

    render(
      <MessageInput
        onSendMessage={() => {}}
        isStreaming={false}
        onAbortMessage={() => {}}
        vscode={vscode}
        modelId="deepseek-v4-flash"
        onModelChange={onModelChange}
        modelSelectApi={api}
      />,
    );

    const select = await screen.findByTestId("muse-model-select");
    expect(select).toHaveValue("deepseek-v4-flash");
    expect(select.closest(".input-container")).not.toBeNull();
  });
});
