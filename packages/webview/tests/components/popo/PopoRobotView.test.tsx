import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PopoRobotView } from "../../../src/components/popo/PopoRobotView";
import type { MuseApiClient } from "../../../src/muse/apiClient";

// Message.tsx 的渲染依赖（与 webview 测试同款 mock）
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

function stubApi(overrides?: Partial<ReturnType<typeof makeApiMocks>>) {
  const api = makeApiMocks();
  if (overrides?.config) api.getPopoConfig.mockResolvedValue(overrides.config);
  if (overrides?.chats) api.listPopoChats.mockResolvedValue({ chats: overrides.chats });
  if (overrides?.detail) api.getPopoChat.mockResolvedValue(overrides.detail);
  return api as unknown as MuseApiClient;
}

function makeApiMocks() {
  return {
    getPopoConfig: vi.fn().mockResolvedValue({
      url: "http://10.0.0.1:3100/popo/callback",
      token: "tk",
      aesKey: "ak",
      masterUid: "me@corp.netease.com",
      port: 3100,
      ready: true,
      error: null,
    }),
    listPopoChats: vi.fn().mockResolvedValue({
      chats: [
        {
          chatKey: "p2p:me@corp.netease.com",
          type: "p2p",
          title: "peer@corp.netease.com",
          lastMessage: "你好",
          processing: false,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          chatKey: "team:1696900",
          type: "team",
          title: "群 1696900",
          lastMessage: "群里问了个问题",
          processing: true,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }),
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

describe("PopoRobotView", () => {
  it("renders the config card with URL/token/aesKey/master", async () => {
    render(<PopoRobotView api={stubApi()} vscode={vscode} />);
    expect(await screen.findByText("http://10.0.0.1:3100/popo/callback")).toBeInTheDocument();
    expect(screen.getByText("tk")).toBeInTheDocument();
    expect(screen.getByText("ak")).toBeInTheDocument();
    expect(screen.getByText("me@corp.netease.com")).toBeInTheDocument();
  });

  it("shows chat list with processing spinner on active chats", async () => {
    render(<PopoRobotView api={stubApi()} vscode={vscode} />);
    await screen.findByText("群 1696900");
    // 列表项出现处理中 spinner（processing chat）
    expect(screen.getByTestId("popo-chat-team:1696900").querySelector(".popo-chat-spinner")).toBeInTheDocument();
  });

  it("renders the full assistant process (reasoning + text) in chat detail", async () => {
    const user = userEvent.setup();
    render(<PopoRobotView api={stubApi()} vscode={vscode} />);
    await screen.findByText("群 1696900");
    await user.click(screen.getByText("群 1696900"));
    await waitFor(() => {
      expect(screen.getByText("答案在这")).toBeInTheDocument();
    });
    expect(screen.getByText("让我想想")).toBeInTheDocument();
  });

  it("shows the processing indicator while the chat is being processed", async () => {
    const api = stubApi();
    (api.getPopoChat as ReturnType<typeof vi.fn>).mockResolvedValue({
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
    const user = userEvent.setup();
    render(<PopoRobotView api={api} vscode={vscode} />);
    await screen.findByText("群 1696900");
    await user.click(screen.getByText("群 1696900"));
    expect(await screen.findAllByTestId("popo-processing")).not.toHaveLength(0);
    expect(screen.getAllByText("处理中…").length).toBeGreaterThan(0);
  });

  it("polls the detail while processing and stops after completion", async () => {
    // 只劫持 setInterval：waitFor/findBy 依赖真实 setTimeout
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = stubApi();
    let processing = true;
    // 列表与详情都随 processing 变化（新逻辑：任一 chat processing 即轮询）
    (api.listPopoChats as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      chats: [
        {
          chatKey: "team:1696900",
          type: "team",
          title: "群 1696900",
          lastMessage: "hi",
          processing,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }));
    (api.getPopoChat as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
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
    const user = userEvent.setup();
    render(<PopoRobotView api={api} vscode={vscode} />);
    await screen.findByText("群 1696900");
    await user.click(screen.getByText("群 1696900"));
    await screen.findAllByTestId("popo-processing");
    const callsDuringProcessing = (api.getPopoChat as ReturnType<typeof vi.fn>).mock.calls.length;

    // 处理中：轮询继续拉取
    processing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect((api.getPopoChat as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsDuringProcessing,
    );
    expect(await screen.findByText("结果来了")).toBeInTheDocument();

    // 处理完成：轮询停止
    const callsAfterDone = (api.getPopoChat as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect((api.getPopoChat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterDone);
    vi.useRealTimers();
  });

  it("shows the degraded notice when callback not ready", async () => {
    const api = stubApi({
      config: {
        url: "http://10.0.0.1:3100/popo/callback",
        token: "tk",
        aesKey: "ak",
        masterUid: "me@corp.netease.com",
        port: 3100,
        ready: false,
        error: "listen EADDRINUSE: 3100",
      },
    });
    render(<PopoRobotView api={api} vscode={vscode} />);
    expect(await screen.findByText("回调未就绪")).toBeInTheDocument();
    expect(screen.getByText(/EADDRINUSE/)).toBeInTheDocument();
  });
});
