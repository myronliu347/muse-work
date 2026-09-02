import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PopoChatDetail } from "../../../src/components/popo/PopoChatDetail";
import type { MuseApiClient } from "../../../src/muse/apiClient";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));
vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));
vi.mock("../../../src/styles/ChatApp.css", () => ({}));
vi.mock("../../../src/styles/globals.css", () => ({}));
vi.mock("@vscode/codicons/dist/codicon.css", () => ({}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };

function makeApiMocks() {
  return {
    getPopoChat: vi.fn().mockResolvedValue({
      chat: {
        chatKey: "team:1696900",
        type: "team",
        title: "群 1696900",
        processing: false,
        createdAt: 2,
        updatedAt: 2,
      },
      messages: [
        {
          id: "m1",
          role: "user",
          blocks: [{ type: "text", content: "群里问了个问题" }],
        },
        {
          id: "m2",
          role: "assistant",
          blocks: [
            { type: "reasoning", content: "让我想想" },
            { type: "text", content: "答案在这" },
          ],
        },
      ],
    }),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PopoChatDetail", () => {
  it("renders the full assistant process and no composer", async () => {
    const api = makeApiMocks() as unknown as MuseApiClient;
    render(
      <PopoChatDetail api={api} vscode={vscode} chatKey="team:1696900" />,
    );
    await waitFor(() => {
      expect(screen.getByText("答案在这")).toBeInTheDocument();
    });
    expect(screen.getByText("让我想想")).toBeInTheDocument();
    expect(screen.getByTestId("popo-chat-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).toBeNull();
    expect(screen.queryByTestId("popo-config-card")).toBeNull();
    expect(screen.queryByTestId("popo-chat-list")).toBeNull();
  });

  it("shows the processing indicator while the chat is being processed", async () => {
    const api = makeApiMocks();
    api.getPopoChat.mockResolvedValue({
      chat: {
        chatKey: "team:1696900",
        type: "team",
        title: "群 1696900",
        processing: true,
        createdAt: 2,
        updatedAt: 2,
      },
      messages: [
        { id: "m1", role: "user", blocks: [{ type: "text", content: "群里问了个问题" }] },
      ],
    });
    render(
      <PopoChatDetail
        api={api as unknown as MuseApiClient}
        vscode={vscode}
        chatKey="team:1696900"
      />,
    );
    expect(await screen.findAllByTestId("popo-processing")).not.toHaveLength(0);
  });

  it("polls the detail while processing and stops after completion", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = makeApiMocks();
    let processing = true;
    api.getPopoChat.mockImplementation(async () => ({
      chat: {
        chatKey: "team:1696900",
        type: "team",
        title: "群 1696900",
        processing,
        createdAt: 2,
        updatedAt: 2,
      },
      messages: [
        { id: "m1", role: "user", blocks: [{ type: "text", content: "hi" }] },
        ...(processing
          ? []
          : [{ id: "m2", role: "assistant", blocks: [{ type: "text", content: "结果来了" }] }]),
      ],
    }));
    render(
      <PopoChatDetail
        api={api as unknown as MuseApiClient}
        vscode={vscode}
        chatKey="team:1696900"
      />,
    );
    await screen.findAllByTestId("popo-processing");
    const callsDuringProcessing = api.getPopoChat.mock.calls.length;

    processing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getPopoChat.mock.calls.length).toBeGreaterThan(callsDuringProcessing);
    expect(await screen.findByText("结果来了")).toBeInTheDocument();

    const callsAfterDone = api.getPopoChat.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getPopoChat.mock.calls.length).toBe(callsAfterDone);
    vi.useRealTimers();
  });
});
