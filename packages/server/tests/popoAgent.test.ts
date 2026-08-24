import { describe, expect, it, vi } from "vitest";
import { createPopoAgentFactory } from "../src/popo/popoAgent.js";
import type { SessionAgent } from "../src/services/sessionRunner.js";

function stubAgent(finalText: string): SessionAgent {
  const messages = [
    { role: "user" as const, blocks: [{ type: "text" as const, content: "u" }] },
    { role: "assistant" as const, blocks: [{ type: "text" as const, content: finalText }] },
  ];
  return {
    sendMessage: async () => undefined,
    askBtw: async () => undefined,
    abortMessage: () => undefined,
    dispose: () => undefined,
    getMessages: () => messages,
    sessionId: "wave-1",
    compact: async () => undefined,
    clearMessages: () => undefined,
    truncateHistory: () => undefined,
    setPermissionMode: () => undefined,
    getPermissionMode: () => "bypassPermissions",
    getMcpServers: () => [],
    connectMcpServer: async () => ({ ok: true }),
    disconnectMcpServer: async () => ({ ok: true }),
    getBackgroundTaskOutput: async () => ({ output: null }),
    stopBackgroundTask: async () => ({ ok: true }),
    getWorkflowRuns: async () => [],
    stopWorkflowRun: async () => ({ ok: true }),
    hasPendingMessages: () => false,
    removeQueuedMessageById: () => false,
    updateQueuedMessageById: () => false,
    isLoading: () => false,
    hasRunningBackgroundWork: () => false,
    queuedMessages: () => [],
    latestTotalTokens: 0,
  } as SessionAgent;
}

const registryStub = {
  get: () => ({
    id: "codemaker",
    listModels: async () => [{ id: "m1", label: "M1" }],
    resolveGateway: async (model: string) => ({ baseURL: "http://gw", model }),
  }),
  getActive: () => ({ providerId: "codemaker", modelId: undefined }),
} as never;

describe("popoAgent", () => {
  it("run returns the last assistant text block", async () => {
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => stubAgent("最终回复"),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    expect(await runner.run("hello")).toBe("最终回复");
  });

  it("throws when no assistant text produced", async () => {
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () =>
        stubAgent("") as SessionAgent & {
          getMessages: () => {
            role: "assistant";
            blocks: { type: "error"; content: string }[];
          }[];
        },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await expect(runner.run("hello")).rejects.toThrow(/未生成回复|回复为空/);
  });

  it("keeps p2p agents resident: reused across runs and never disposed", async () => {
    let createCalls = 0;
    let disposeCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => {
        createCalls += 1;
        return {
          ...stubAgent("最终回复"),
          dispose: () => {
            disposeCalls += 1;
          },
        };
      },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.run("hello");
    await runner.run("hello again");
    expect(createCalls).toBe(1); // 复用同一 agent
    expect(disposeCalls).toBe(0); // 不销毁
  });

  it("does not schedule background-task disposal for resident p2p agents", async () => {
    vi.useFakeTimers();
    let disposeCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("最终回复"),
        hasRunningBackgroundWork: () => true, // 一直有后台任务
        dispose: () => {
          disposeCalls += 1;
        },
      }),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.run("hello");
    // 常驻 agent：不注册轮询、不销毁
    await vi.advanceTimersByTimeAsync(20000);
    expect(disposeCalls).toBe(0);
    vi.useRealTimers();
  });

  it("disposes the team agent after run resolves", async () => {
    let disposeCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("最终回复"),
        dispose: () => {
          disposeCalls += 1;
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    expect(await runner.run("hello")).toBe("最终回复");
    expect(disposeCalls).toBe(1);
  });

  it("disposes the team agent even when run throws", async () => {
    let disposeCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ignored"),
        sendMessage: async () => {
          throw new Error("模型超时");
        },
        dispose: () => {
          disposeCalls += 1;
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    await expect(runner.run("hello")).rejects.toThrow("模型超时");
    expect(disposeCalls).toBe(1);
  });

  it("serializes concurrent runs per chat even after chains are dropped", async () => {
    const order: string[] = [];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        sendMessage: async () => {
          order.push("start");
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push("end");
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    await Promise.all([runner.run("a"), runner.run("b")]);
    // 串行：第一条消息的 sendMessage 完整结束后第二条才开始。
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("reports the agent sessionId after run so the detail route can load full messages", async () => {
    const waveSessionIds: Array<{ chatKey: string; sessionId: string }> = [];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => stubAgent("最终回复"),
      onWaveSessionId: (chatKey, sessionId) => {
        waveSessionIds.push({ chatKey, sessionId });
      },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.run("hello");
    expect(waveSessionIds).toEqual([{ chatKey: "p2p:x", sessionId: "wave-1" }]);
  });

  it("disallows the Workflow tool and forbids background tasks in the system prompt", async () => {
    let captured: Record<string, unknown> | undefined;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return stubAgent("ok");
      },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.run("hello");
    // Workflow 硬禁用（后台运行、完成通知本场景收不到）
    expect(captured?.disallowedTools).toEqual(["Workflow"]);
    // 系统提示明确禁止后台任务
    expect(String(captured?.systemPrompt)).toContain("run_in_background");
    expect(String(captured?.systemPrompt)).toContain("不要创建定时任务");
  });

  it("keeps the agent alive while a background task runs, disposing after it settles", async () => {
    vi.useFakeTimers();
    let running = true;
    let disposeCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("最终回复"),
        hasRunningBackgroundWork: () => running,
        dispose: () => {
          disposeCalls += 1;
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    // 后台任务运行中：run 正常返回，但不销毁 agent
    expect(await runner.run("hello")).toBe("最终回复");
    expect(disposeCalls).toBe(0);
    // 任务结束后：共享轮询（5s 间隔）销毁 agent
    running = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(disposeCalls).toBe(1);
    // 再次推进：集合已清空，不再有定时器
    await vi.advanceTimersByTimeAsync(5000);
    expect(disposeCalls).toBe(1);
    vi.useRealTimers();
  });

  it("shares one poll loop across multiple agents with background tasks", async () => {
    vi.useFakeTimers();
    const flags: Array<{ running: boolean; disposed: boolean }> = [];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => {
        const f = { running: true, disposed: false };
        flags.push(f);
        return {
          ...stubAgent("回复"),
          hasRunningBackgroundWork: () => f.running,
          dispose: () => {
            f.disposed = true;
          },
        };
      },
    });
    const r1 = await factory({ chatKey: "team:1", type: "team" });
    const r2 = await factory({ chatKey: "team:2", type: "team" });
    await r1.run("x");
    await r2.run("y");
    // 两个 agent 后台任务都在跑：都不销毁
    expect(flags.every((f) => !f.disposed)).toBe(true);

    // 第二个任务结束：同一轮询只销毁第二个，第一个保留
    flags[1].running = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(flags[0].disposed).toBe(false);
    expect(flags[1].disposed).toBe(true);

    // 第一个也结束：销毁；集合清空后定时器停止（再推进无新增销毁）
    flags[0].running = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(flags.map((f) => f.disposed)).toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(flags.map((f) => f.disposed)).toEqual([true, true]);
    vi.useRealTimers();
  });

  it("swallows dispose errors and still returns the reply", async () => {
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("最终回复"),
        dispose: () => {
          throw new Error("dispose boom");
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    expect(await runner.run("hello")).toBe("最终回复");
  });

  it("passes the always-on todo plugin into the SDK agent", async () => {
    let seenPlugins: unknown;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async (options) => {
        seenPlugins = options.plugins;
        return stubAgent("ok");
      },
    });
    const runner = await factory({ chatKey: "team:todo", type: "team" });
    await runner.run("记个 todo：xxx");
    expect(seenPlugins).toEqual([
      { type: "local", path: expect.stringMatching(/plugins[\\/]todo$/) },
    ]);
  });
});
