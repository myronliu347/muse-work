import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { callAgent } from "../../src/services/aiService.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { TaskManager } from "../../src/services/taskManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("../../src/utils/gitUtils.js", () => ({ isGitRepository: vi.fn() }));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compactMessages: vi.fn().mockResolvedValue({
    content: "Compacted content",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));
vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

const mockGatewayConfig: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "https://test-gateway.com",
};

const mockModelConfig: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
};

const usage = {
  prompt_tokens: 10,
  completion_tokens: 20,
  total_tokens: 30,
};

function buildHarness(queueChanges: unknown[]) {
  const container = new Container();
  const messageQueue = new MessageQueue();
  container.register("MessageQueue", messageQueue);
  container.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
  });
  const messageManager = {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn().mockReturnValue([]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn().mockReturnValue("msg-id"),
    addNotificationMessage: vi.fn(),
    appendCurrentMessageContent: vi.fn(),
    updateToolBlock: vi.fn(),
    mergeAssistantAdditionalFields: vi.fn(),
    setMessages: vi.fn(),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    getCombinedMemory: vi.fn().mockResolvedValue(""),
    getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
    processTriggeredRules: vi.fn().mockReturnValue([]),
    addErrorBlock: vi.fn(),
    setlatestTotalTokens: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    compactMessagesAndUpdateSession: vi.fn(),
    getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    triggerFileRead: vi.fn(),
    finalizeStreamingBlocks: vi.fn(),
    finalizeAbortedToolBlocks: vi.fn(),
  } as unknown as MessageManager;
  container.register("MessageManager", messageManager);
  container.register("ToolManager", {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ success: true, content: "ok" }),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager);
  container.register("TaskManager", {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as TaskManager);
  container.register("MemoryService", {
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  });
  container.register("PermissionManager", {
    getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
    clearTemporaryRules: vi.fn(),
  });
  container.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
    callbacks: {
      onQueuedMessagesChange: (messages) => {
        queueChanges.push(messages);
      },
    },
  });
  return { aiManager, messageQueue, messageManager };
}

describe("AIManager steers queued user input into the active turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues the same turn when a user message arrives before the model stops", async () => {
    const queueChanges: unknown[] = [];
    const { aiManager, messageQueue, messageManager } = buildHarness(queueChanges);
    const loadingAtSecondCall: boolean[] = [];

    vi.mocked(callAgent).mockImplementation(async () => {
      const call = vi.mocked(callAgent).mock.calls.length;
      if (call === 1) {
        messageQueue.enqueue({ content: "改用配置文件" });
        messageQueue.enqueue({ content: "/compact" });
        return { content: "先看代码", tool_calls: [], usage };
      }
      loadingAtSecondCall.push(aiManager.isLoading);
      return { content: "好", tool_calls: [], usage };
    });

    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledTimes(2);
    expect(loadingAtSecondCall).toEqual([true]);
    expect(messageManager.addUserMessage).toHaveBeenCalledWith({
      content: "改用配置文件",
    });
    expect(messageQueue.getQueue().map((message) => message.content)).toEqual([
      "/compact",
    ]);
    expect(queueChanges.at(-1)).toEqual([
      expect.objectContaining({ content: "/compact" }),
    ]);
    expect(aiManager.isLoading).toBe(false);
  });

  it("folds a queued user message in before the next request after tools return", async () => {
    const { aiManager, messageQueue, messageManager } = buildHarness([]);
    let sawUserMessageBeforeSecondCall = false;

    vi.mocked(callAgent).mockImplementation(async () => {
      const call = vi.mocked(callAgent).mock.calls.length;
      if (call === 1) {
        messageQueue.enqueue({ content: "顺便看配置" });
        return {
          content: "",
          usage,
          tool_calls: [
            {
              type: "function" as const,
              id: "call-1",
              function: { name: "test-tool", arguments: "{}" },
            },
          ],
        };
      }
      sawUserMessageBeforeSecondCall = vi
        .mocked(messageManager.addUserMessage)
        .mock.calls.some((args) => args[0]?.content === "顺便看配置");
      return { content: "看过了", tool_calls: [], usage };
    });

    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledTimes(2);
    expect(sawUserMessageBeforeSecondCall).toBe(true);
    expect(messageQueue.getQueue()).toEqual([]);
  });
});
