import { describe, expect, it } from "vitest";
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

  it("disposes the agent after run resolves", async () => {
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
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    expect(await runner.run("hello")).toBe("最终回复");
    expect(disposeCalls).toBe(1);
  });

  it("disposes the agent even when run throws", async () => {
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
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await expect(runner.run("hello")).rejects.toThrow("模型超时");
    expect(disposeCalls).toBe(1);
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
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    expect(await runner.run("hello")).toBe("最终回复");
  });
});
