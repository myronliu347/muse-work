import { describe, expect, it, vi } from "vitest";
import { TEAM_BTW_IDLE, createPopoAgentFactory } from "../src/popo/popoAgent.js";
import type { SessionAgent } from "../src/services/sessionRunner/index.js";

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

  it("disposeChat drops the resident p2p agent so the next factory call creates a new one", async () => {
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
    await factory.disposeChat("p2p:x");
    expect(disposeCalls).toBe(1);
    const next = await factory({ chatKey: "p2p:x", type: "p2p" });
    await next.run("hello again");
    expect(createCalls).toBe(2);
  });

  it("recreates p2p agent when credential fingerprint changes (token renew)", async () => {
    let fingerprint = "cred-v1";
    const restoreIds: Array<string | undefined> = [];
    let createCalls = 0;
    let disposeCalls = 0;
    const registry = {
      get: () => ({
        id: "codemaker",
        listModels: async () => [{ id: "m1", label: "M1" }],
        resolveGateway: async (model: string) => ({
          baseURL: "http://gw",
          model,
          credentialFingerprint: fingerprint,
        }),
      }),
      getActive: () => ({ providerId: "codemaker", modelId: undefined }),
    } as never;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry,
      createAgent: async (opts) => {
        createCalls += 1;
        restoreIds.push(opts.restoreSessionId);
        return {
          ...stubAgent("最终回复"),
          sessionId: "wave-1",
          dispose: () => {
            disposeCalls += 1;
          },
        };
      },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.run("hello");
    expect(createCalls).toBe(1);
    expect(disposeCalls).toBe(0);

    fingerprint = "cred-v2";
    await runner.run("again");
    expect(createCalls).toBe(2);
    expect(disposeCalls).toBe(1);
    expect(restoreIds[1]).toBe("wave-1");
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

  it("falls back to a new agent when restoreSessionId is missing on disk", async () => {
    const restoreIds: Array<string | undefined> = [];
    const waveSessionIds: string[] = [];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async (opts) => {
        restoreIds.push(opts.restoreSessionId);
        if (opts.restoreSessionId === "2ad60df9-4710-4cf8-8d27-9a3e4829ed71") {
          throw new Error(
            "Session 2ad60df9-4710-4cf8-8d27-9a3e4829ed71 not found on disk",
          );
        }
        return { ...stubAgent("新会话回复"), sessionId: "wave-fresh" };
      },
      onWaveSessionId: (_chatKey, sessionId) => {
        waveSessionIds.push(sessionId);
      },
    });
    const runner = await factory({
      chatKey: "p2p:x",
      type: "p2p",
      waveSessionId: "2ad60df9-4710-4cf8-8d27-9a3e4829ed71",
    });
    expect(await runner.run("hello")).toBe("新会话回复");
    expect(restoreIds).toEqual([
      "2ad60df9-4710-4cf8-8d27-9a3e4829ed71",
      undefined,
    ]);
    expect(waveSessionIds).toContain("wave-fresh");
  });

  it("team run also falls back when the persisted session jsonl is gone", async () => {
    const restoreIds: Array<string | undefined> = [];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async (opts) => {
        restoreIds.push(opts.restoreSessionId);
        if (opts.restoreSessionId) {
          throw new Error(`Session ${opts.restoreSessionId} not found on disk`);
        }
        return stubAgent("群聊回复");
      },
    });
    const runner = await factory({
      chatKey: "team:1",
      type: "team",
      waveSessionId: "missing-on-disk",
    });
    expect(await runner.run("hello")).toBe("群聊回复");
    expect(restoreIds).toEqual(["missing-on-disk", undefined]);
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

  it("popo 场景 agent：systemPrompt 含人格段 + POPO 指令；disallowedTools 保留 Workflow", async () => {
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
    // popo 场景 agent（默认 popo 内置）→ 人格段 + POPO 指令
    expect(String(captured?.systemPrompt)).toContain("你是Muse。你的性格：用语规范、逻辑严密、直奔重点，不过度寒暄。");
    expect(String(captured?.systemPrompt)).toContain("你是 Muse 机器人，运行在 POPO 即时通讯上");
    expect(captured?.disallowedTools).toEqual(["Workflow"]);
    // fastModel 不给时保持 gateway.fastModel ?? gateway.model（这里 gateway 无 fastModel → model）
    expect(captured?.fastModel).toBe("m1");
  });

  it("mounts issue and automation plugins so POPO can manage issues and rules", async () => {
    let captured: { plugins?: Array<{ type: string; path: string }> } | undefined;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async (options) => {
        captured = options as { plugins?: Array<{ type: string; path: string }> };
        return stubAgent("ok");
      },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.run("hello");
    const mounted = JSON.stringify(captured?.plugins ?? []);
    expect(mounted).toContain("plugins/issue");
    expect(mounted).toContain("plugins/automation");
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

  it("does not attach a todo plugin to the SDK agent", async () => {
    let seenPlugins: unknown;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async (options) => {
        seenPlugins = options.plugins;
        return stubAgent("ok");
      },
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    await runner.run("hello");
    expect(JSON.stringify(seenPlugins ?? [])).not.toContain("plugins/todo");
    expect(JSON.stringify(seenPlugins ?? [])).toContain("plugins/issue");
    expect(JSON.stringify(seenPlugins ?? [])).toContain("plugins/automation");
  });

  it("p2p clear calls agent.clearMessages", async () => {
    let clearCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("x"),
        clearMessages: async () => {
          clearCalls += 1;
        },
      }),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await runner.clear?.();
    expect(clearCalls).toBe(1);
  });

  it("p2p clear is serialized behind an in-flight run", async () => {
    const order: string[] = [];
    let releaseSend: () => void = () => undefined;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        sendMessage: async () => {
          order.push("run-start");
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
          order.push("run-end");
        },
        clearMessages: async () => {
          order.push("clear");
        },
      }),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    const runPromise = runner.run("hello");
    await vi.waitFor(() => expect(order).toContain("run-start"));
    const clearPromise = runner.clear?.();
    expect(order).toEqual(["run-start"]);
    releaseSend();
    await Promise.all([runPromise, clearPromise]);
    // clear 等正在跑的消息完整结束后才执行，不与消息交错
    expect(order).toEqual(["run-start", "run-end", "clear"]);
  });

  it("team clear is a no-op and does not create an agent", async () => {
    let createCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => {
        createCalls += 1;
        return stubAgent("x");
      },
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    await runner.clear?.();
    expect(createCalls).toBe(0);
  });

  it("p2p askBtw calls agent.askBtw directly without the serialized chain", async () => {
    const questions: string[] = [];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        askBtw: async (q: string) => {
          questions.push(q);
          return `进度：${q}`;
        },
      }),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    expect(await runner.askBtw?.("进度如何")).toBe("进度：进度如何");
    expect(questions).toEqual(["进度如何"]);
  });

  it("p2p askBtw does not wait behind an in-flight run (bypasses serialized chain)", async () => {
    const order: string[] = [];
    let releaseSend: () => void = () => undefined;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        sendMessage: async () => {
          order.push("run-start");
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
          order.push("run-end");
        },
        askBtw: async () => {
          order.push("btw");
          return "实时进度";
        },
      }),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    const runPromise = runner.run("hello");
    await vi.waitFor(() => expect(order).toContain("run-start"));
    // 主 turn 还在跑，/btw 直接旁路回答，不排队等 run 结束
    expect(await runner.askBtw?.("进度如何")).toBe("实时进度");
    expect(order).toEqual(["run-start", "btw"]);
    releaseSend();
    await runPromise;
    expect(order).toEqual(["run-start", "btw", "run-end"]);
  });

  it("team askBtw returns the unsupported message without creating an agent", async () => {
    let createCalls = 0;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => {
        createCalls += 1;
        return stubAgent("x");
      },
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    expect(await runner.askBtw?.("进度如何")).toBe(TEAM_BTW_IDLE);
    expect(createCalls).toBe(0);
  });

  it("team askBtw asks the in-flight agent for progress while a run is active", async () => {
    const order: string[] = [];
    const questions: string[] = [];
    let releaseSend: () => void = () => undefined;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        sendMessage: async () => {
          order.push("run-start");
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
          order.push("run-end");
        },
        askBtw: async (q: string) => {
          questions.push(q);
          return `群内进度：${q}`;
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    const runPromise = runner.run("hello");
    await vi.waitFor(() => expect(order).toContain("run-start"));
    // 消息处理中：/btw 问当前正在跑的 agent，实时回答
    expect(await runner.askBtw?.("进度如何")).toBe("群内进度：进度如何");
    expect(questions).toEqual(["进度如何"]);
    releaseSend();
    await runPromise;
    // run 结束后 agent 已销毁，/btw 回到空闲提示
    expect(await runner.askBtw?.("进度如何")).toBe(TEAM_BTW_IDLE);
  });

  it("team askBtw falls back to idle when the in-flight agent has no askBtw", async () => {
    const order: string[] = [];
    let releaseSend: () => void = () => undefined;
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        askBtw: undefined,
        sendMessage: async () => {
          order.push("run-start");
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
          order.push("run-end");
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    const runPromise = runner.run("hello");
    // 等 agent 登记进 activeAgents（run 里 createSdkAgent 后、sendMessage 前登记）
    await vi.waitFor(() => expect(order).toContain("run-start"));
    expect(await runner.askBtw?.("进度如何")).toBe(TEAM_BTW_IDLE);
    releaseSend();
    await runPromise;
  });

  it("exposes in-flight team messages so the detail route can show progress", async () => {
    let releaseSend: () => void = () => undefined;
    const live = [
      { role: "user", blocks: [{ type: "text", content: "分析日志" }] },
      {
        role: "assistant",
        blocks: [
          { type: "reasoning", content: "先下载沙箱日志" },
          { type: "text", content: "ok" },
        ],
      },
    ];
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => ({
        ...stubAgent("ok"),
        getMessages: () => live,
        sendMessage: async () => {
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
        },
      }),
    });
    const runner = await factory({ chatKey: "team:1", type: "team" });
    const runPromise = runner.run("hello");
    await vi.waitFor(() => {
      expect(factory.getLiveMessages?.("team:1")).toEqual(live);
    });
    releaseSend();
    await runPromise;
    expect(factory.getLiveMessages?.("team:1") ?? []).toEqual([]);
  });
});
