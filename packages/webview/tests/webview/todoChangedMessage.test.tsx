import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { useTodoBoardStore } from "../../src/stores/todoBoardStore";
import {
  renderChatApp,
  sendExtensionMessage,
  createMockVscode,
} from "./test-utils";

/**
 * todo:changed 宿主消息（server 变更路由广播，对话内 AI 跑 todo.mjs 等
 * 非看板 UI 来源的变更）→ messageRouter 处理：看板从未打开时注入 api 全量
 * 拉取（badge 真实计数），已打开时重拉，并刷新侧栏任务分组。
 */
describe("todo:changed host message (messageRouter)", () => {
  beforeEach(() => {
    // 看板未打开时 init(popoApi) → load() 会发真实请求：stub fetch 兜底
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("看板从未打开：注入 api（init）+ 触发刷新侧栏", async () => {
    const vscode = createMockVscode();
    renderChatApp(vscode);
    expect(useTodoBoardStore.getState().api).toBeNull();

    await act(async () => {
      sendExtensionMessage({ command: "todo:changed" });
    });

    // init 路径：真实 popoApi 被注入（badge 需要真实计数）
    expect(useTodoBoardStore.getState().api).not.toBeNull();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopRefreshSessionTree",
    });
  });

  it("看板已打开（api 已注入）：走 load 重拉，不重复 init", async () => {
    const vscode = createMockVscode();
    renderChatApp(vscode);
    const mockApi = {
      listTodos: vi.fn().mockResolvedValue({ todos: [] }),
      listTasks: vi.fn().mockResolvedValue({ tasks: [] }),
    } as unknown as ReturnType<typeof useTodoBoardStore.getState>["api"];
    useTodoBoardStore.setState({ api: mockApi });

    await act(async () => {
      sendExtensionMessage({ command: "todo:changed" });
    });

    // load 路径：listTodos 被调；api 引用未变（init 未被再次调用覆盖）
    await waitFor(() => expect(mockApi.listTodos).toHaveBeenCalled());
    expect(useTodoBoardStore.getState().api).toBe(mockApi);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopRefreshSessionTree",
    });
  });
});
