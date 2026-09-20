/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { MuseModelSelect } from "../../src/components/shared/MuseModelSelect";
import { MessageInput } from "../../src/components/chat/MessageInput";
import type { MuseApiClient } from "../../src/muse/apiClient";

// radix Select / portal 依赖的指针捕获方法，jsdom 未实现
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

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

function renderModelSelect(
  props: Partial<React.ComponentProps<typeof MuseModelSelect>> = {},
) {
  const api = props.api ?? stubProvidersApi();
  return {
    api: api as MuseApiClient & { setActive: ReturnType<typeof vi.fn> },
    onModelChange: props.onModelChange ?? vi.fn(),
    ...render(
      <Theme>
        <MuseModelSelect
          api={api}
          onModelChange={props.onModelChange ?? (() => {})}
          {...props}
        />
      </Theme>,
    ),
  };
}

/** Open the Radix dropdown and pick an option by its display label. */
async function pickOption(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Model" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("MuseModelSelect controlled session mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses modelId prop and calls onModelChange without setActive", async () => {
    const onModelChange = vi.fn();
    const api = stubProvidersApi();

    render(
      <Theme>
        <MuseModelSelect
          api={api}
          modelId="deepseek-v4-flash"
          onModelChange={onModelChange}
        />
      </Theme>,
    );

    const trigger = await screen.findByTestId("muse-model-select");
    expect(trigger).toHaveTextContent("DeepSeek V4 Flash");

    await pickOption("DeepSeek V4 Pro");

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-pro");
    });
    expect(api.setActive).not.toHaveBeenCalled();
  });

  it("treats empty modelId as unset and keeps the session default", async () => {
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
        active: { providerId: "codemaker", modelId: "claude-opus-4-6" },
      })),
    });

    render(
      <Theme>
        <MuseModelSelect api={api} modelId="" onModelChange={() => {}} />
      </Theme>,
    );

    const trigger = await screen.findByTestId("muse-model-select");
    expect(trigger).toHaveTextContent("DeepSeek V4 Flash");
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

    render(
      <Theme>
        <MuseModelSelect api={api} onModelChange={() => {}} />
      </Theme>,
    );

    const trigger = await screen.findByTestId("muse-model-select");
    expect(trigger).toHaveTextContent("DeepSeek V4 Flash");
  });

  it("commits a user pick via the Radix dropdown", async () => {
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
      <Theme>
        <MuseModelSelect
          api={api}
          modelId="deepseek-v4-flash"
          onModelChange={onModelChange}
        />
      </Theme>,
    );

    await pickOption("Claude Opus 4.6");

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith("claude-opus-4-6");
    });
  });

  it("allowEmpty maps the empty option back to an empty modelId", async () => {
    const onModelChange = vi.fn();
    const api = stubProvidersApi();

    render(
      <Theme>
        <MuseModelSelect
          api={api}
          modelId="deepseek-v4-flash"
          onModelChange={onModelChange}
          allowEmpty
          emptyLabel="（留空）"
        />
      </Theme>,
    );

    await pickOption("（留空）");

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith("");
    });
  });

  it("syncGlobalActive still posts providers/active", async () => {
    const onModelChange = vi.fn();
    const api = stubProvidersApi();

    render(
      <Theme>
        <MuseModelSelect
          api={api}
          modelId="deepseek-v4-pro"
          onModelChange={onModelChange}
          syncGlobalActive
        />
      </Theme>,
    );

    await pickOption("DeepSeek V4 Flash");

    await waitFor(() => {
      expect(api.setActive).toHaveBeenCalledWith(
        "codemaker",
        "deepseek-v4-flash",
      );
    });
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
  });

  it("shows a hover tooltip with the full model name", async () => {
    renderModelSelect({ modelId: "deepseek-v4-flash" });

    const trigger = await screen.findByTestId("muse-model-select");
    const container = trigger.closest(".tooltip-container") as HTMLElement;
    expect(container).not.toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(container);
    });

    await waitFor(() => {
      const tooltip = document.querySelector(".tooltip-box.visible");
      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveTextContent("CodeMaker · DeepSeek V4 Flash");
    });

    await act(async () => {
      fireEvent.mouseLeave(container);
    });
    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).toBeNull();
    });
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
      <Theme>
        <MessageInput
          onSendMessage={() => {}}
          isStreaming={false}
          onAbortMessage={() => {}}
          vscode={vscode}
          modelId="deepseek-v4-flash"
          onModelChange={onModelChange}
          modelSelectApi={api}
        />
      </Theme>,
    );

    const trigger = await screen.findByTestId("muse-model-select");
    expect(trigger).toHaveTextContent("DeepSeek V4 Flash");
    expect(trigger).toHaveClass("rt-variant-ghost");
    expect(trigger.closest(".input-model-select")).not.toBeNull();
  });
});
