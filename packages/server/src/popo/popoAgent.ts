import fs from "node:fs";
import path from "node:path";
import type { GatewayResolution, ProviderRegistry } from "@muse-work/provider";
import { defaultCreateAgent, type CreateAgent, type SessionAgent } from "../services/sessionRunner/index.js";
import { closeAgentLogger, createAgentLogger } from "../utils/logger.js";
import type { PopoChatType } from "./chatStore.js";
import {
  POPO_DISALLOWED_TOOLS,
  POPO_SYSTEM_PROMPT,
} from "./popoPrompt.js";
import {
  buildSystemPrompt,
  resolveAgent,
  resolvePermission,
  resolveScenarioAgent,
} from "../services/agentConfig.js";
import { pluginDirIfPresent } from "../services/museSettings.js";

export { POPO_SYSTEM_PROMPT, POPO_DISALLOWED_TOOLS };

/** 群聊 /btw：没有正在处理的消息时返回的提示。 */
export const TEAM_BTW_IDLE = "当前没有正在处理的任务，无法询问进度";

export interface PopoAgentRunner {
  run(content: string): Promise<string>;
  /**
   * 清空该会话的 agent 上下文（/clear 命令）。p2p 常驻 runner 实现为
   * agent.clearMessages()（SDK 清内存+换新 sessionId，onWaveSessionId 自动落库）；
   * team runner 每消息新建 agent，无持久上下文可清，空实现。
   */
  clear?(): Promise<void>;
  /**
   * 旁路询问当前进度（/btw 命令）。p2p 常驻 runner 实现为 agent.askBtw(q)——
   * 不走 serialized 串行链（SDK askBtw 是旁路 fork，不打断主 turn，可实时基于当前上下文回答）；
   * team runner 每消息新建 agent，问「正在处理消息的 agent」实时进度；没有正在处理的消息则返回 TEAM_BTW_IDLE。
   */
  askBtw?(question: string): Promise<string>;
}

export interface PopoAgentFactory {
  (chat: { chatKey: string; type: PopoChatType; waveSessionId?: string }): Promise<PopoAgentRunner>;
}

export type PopoAgentFactoryOptions = {
  home: string;
  registry: ProviderRegistry;
  createAgent?: CreateAgent;
  /** 机器人 agent 工作目录；默认 path.join(home, "popo-chat") */
  workdir?: string;
  /** waveSessionId 变化时回调（用于持久化到 chatStore） */
  onWaveSessionId?: (chatKey: string, waveSessionId: string) => void;
};

function sanitizeSessionId(chatKey: string): string {
  return chatKey.replace(/[^a-zA-Z0-9_-]/g, "_");
}

type PopoAgentMessage = {
  role: string;
  blocks: Array<{ type: string; content: string }>;
};

/** 后台任务状态轮询间隔 */
const BACKGROUND_TASK_POLL_MS = 5000;

/**
 * 待销毁 agent 集合 + 单一轮询循环：所有有后台任务的 agent 共用一个
 * 5s 定时器检查，任务全部结束后销毁并从集合移除；集合清空时停表。
 */
const pendingDisposals = new Map<SessionAgent, string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function checkPendingDisposals(): Promise<void> {
  for (const [agent, loggerKey] of [...pendingDisposals]) {
    if (!(agent.hasRunningBackgroundWork?.() ?? false)) {
      pendingDisposals.delete(agent);
      try {
        await agent.dispose();
      } catch {
        // 销毁失败不能掩盖任务结果。
      } finally {
        closeAgentLogger(loggerKey);
      }
    }
  }
  if (pendingDisposals.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function scheduleDisposeWhenSettled(agent: SessionAgent, loggerKey: string): void {
  pendingDisposals.set(agent, loggerKey);
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void checkPendingDisposals();
    }, BACKGROUND_TASK_POLL_MS);
  }
}

export function createPopoAgentFactory(options: PopoAgentFactoryOptions): PopoAgentFactory {
  const createAgent = options.createAgent ?? defaultCreateAgent;
  /** 机器人 agent 工作目录：~/popo-chat（用户指定，与主会话 workdir 隔离） */
  const workdir = options.workdir ?? path.join(options.home, "popo-chat");

  /** p2p 私聊常驻 agent：跨消息复用、不销毁、不轮询后台任务（用户指定）。 */
  const residentAgents = new Map<string, SessionAgent>();
  /** 与 sessionRunner.ensureAgent 相同：gateway 指纹变了（token renew）就重建。 */
  const residentIdentities = new Map<string, string>();
  const residentRunners = new Map<string, PopoAgentRunner>();
  /** 同一 chat 的消息串行执行（常驻 agent / 共享 session 都要求按序）。 */
  const serialChains = new Map<string, Promise<unknown>>();
  /** chatKey → 当前正在处理消息的 agent（team 每消息新建，run 期间登记，供 /btw 实时询问）。 */
  const activeAgents = new Map<string, SessionAgent>();

  function gatewayIdentity(gateway: GatewayResolution): string {
    const credential = gateway.credentialFingerprint ?? gateway.apiKey ?? "";
    return [gateway.baseURL, gateway.model, credential, gateway.fastModel ?? ""].join("\0");
  }

  async function resolvePopoGateway(): Promise<GatewayResolution> {
    const active = options.registry.getActive();
    const provider = options.registry.get(active.providerId);
    if (!provider) throw new Error(`active provider not found: ${active.providerId}`);
    const model = active.modelId ?? (await provider.listModels())[0]?.id;
    if (!model) throw new Error("no active model");
    return provider.resolveGateway(model);
  }

  async function createSdkAgent(
    chat: { chatKey: string; type: PopoChatType; waveSessionId?: string },
    gateway?: GatewayResolution,
  ): Promise<{ agent: SessionAgent; identity: string }> {
    fs.mkdirSync(workdir, { recursive: true });
    const resolved = gateway ?? (await resolvePopoGateway());

    const plugins: Array<{ type: "local"; path: string }> = [];
    const issueDir = pluginDirIfPresent("issue");
    if (issueDir) plugins.push({ type: "local", path: issueDir });

    // popo 场景 agent：默认 popo 内置（systemPrompt 即 POPO 指令）；工具/权限规则生效
    const agent = resolveAgent(resolveScenarioAgent("popo", options.home), options.home);
    const permission = resolvePermission(agent.permission);
    // agent 显式给 fastModel 才覆盖；不给保持 gateway.fastModel ?? gateway.model（与现状一致）
    const fastModel = agent.fastModel ?? resolved.fastModel ?? resolved.model;
    const popoDisallowed = [...POPO_DISALLOWED_TOOLS, ...permission.disallowedTools];

    const sdkAgent = await (createAgent as CreateAgent)({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseURL,
      defaultHeaders: resolved.defaultHeaders,
      fetch: resolved.fetch,
      model: resolved.model,
      fastModel,
      workdir,
      stream: true,
      permissionMode: "bypassPermissions",
      systemPrompt: buildSystemPrompt(agent),
      // Workflow 后台运行且结果通知本场景收不到，硬禁用；agent 的拒绝规则追加进去
      disallowedTools: popoDisallowed,
      ...(permission.allowedTools.length > 0 ? { allowedTools: permission.allowedTools } : {}),
      ...(agent.tools ? { tools: agent.tools } : {}),
      ...(plugins.length > 0 ? { plugins } : {}),
      logger: createAgentLogger({
        home: options.home,
        sessionId: `popo-${sanitizeSessionId(chat.chatKey)}`,
      }),
      ...(chat.waveSessionId ? { restoreSessionId: chat.waveSessionId } : {}),
      callbacks: {
        onSessionIdChange: (id: string) => {
          options.onWaveSessionId?.(chat.chatKey, id);
        },
      },
    });
    return { agent: sdkAgent, identity: gatewayIdentity(resolved) };
  }

  async function refreshResidentAgent(
    chat: { chatKey: string; type: PopoChatType; waveSessionId?: string },
    agentBox: { current: SessionAgent },
  ): Promise<void> {
    const gateway = await resolvePopoGateway();
    const identity = gatewayIdentity(gateway);
    if (identity === residentIdentities.get(chat.chatKey)) return;
    const prev = agentBox.current;
    const restoreId = prev.sessionId ?? chat.waveSessionId;
    const created = await createSdkAgent(
      { ...chat, waveSessionId: restoreId },
      gateway,
    );
    agentBox.current = created.agent;
    residentAgents.set(chat.chatKey, created.agent);
    residentIdentities.set(chat.chatKey, created.identity);
    try {
      await prev.dispose();
    } catch {
      // 旧 agent 释放失败不能挡住带着新 token 的新 agent。
    }
  }

  /** 单轮：sendMessage + 取最后文本。不负责 agent 生命周期（由调用方决定）。 */
  async function runTurn(
    agent: SessionAgent,
    chat: { chatKey: string; type: PopoChatType; waveSessionId?: string },
    content: string,
  ): Promise<string> {
    await agent.sendMessage(content);
    // SDK 的 onSessionIdChange 只在 sessionId 变化时触发（新建 agent 不触发），
    // 这里直接读最终 sessionId 落库，详情路由据此加载完整处理过程。
    if (agent.sessionId) {
      options.onWaveSessionId?.(chat.chatKey, agent.sessionId);
    }
    const msgs = (agent.getMessages?.() ?? []) as PopoAgentMessage[];
    const last = msgs[msgs.length - 1];
    const text = last?.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { content: string }).content)
      .join("");
    if (text) return text;
    const error = last?.blocks.find((b) => b.type === "error");
    if (error) {
      throw new Error((error as { content: string }).content || "agent 回复为空");
    }
    throw new Error("agent 未生成回复");
  }

  /** 同一 chat 的 run 串行排队（并发回调不冲突）。 */
  function serialized(chatKey: string, fn: () => Promise<string>): Promise<string> {
    const prev = serialChains.get(chatKey) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const chain = next.catch(() => undefined);
    serialChains.set(chatKey, chain);
    // Drop the settled chain so idle chats don't accumulate Map entries
    // forever (only remove if this is still the latest chain).
    void chain.then(() => {
      if (serialChains.get(chatKey) === chain) {
        serialChains.delete(chatKey);
      }
    });
    return next;
  }

  return async (chat) => {
    // p2p 私聊：常驻 agent，复用 runner，不销毁也不轮询后台任务。
    if (chat.type === "p2p") {
      const existing = residentRunners.get(chat.chatKey);
      if (existing) return existing;
      const created = await createSdkAgent(chat);
      const agentBox = { current: created.agent };
      residentAgents.set(chat.chatKey, created.agent);
      residentIdentities.set(chat.chatKey, created.identity);
      const runner: PopoAgentRunner = {
        run: (content) =>
          serialized(chat.chatKey, async () => {
            await refreshResidentAgent(chat, agentBox);
            return runTurn(agentBox.current, chat, content);
          }),
        // 与 run 同链串行：等正在跑的消息结束后再清，避免上下文交错。
        clear: () =>
          serialized(chat.chatKey, async () => {
            await agentBox.current.clearMessages?.();
            return "";
          }).then(() => undefined),
        // 不走 serialized 串行链：SDK askBtw 是旁路 fork，不打断主 turn，
        // 基于当前上下文实时回答（无工具、不写消息、不落盘）。
        askBtw: (question) =>
          agentBox.current.askBtw?.(question) ?? Promise.resolve(TEAM_BTW_IDLE),
      };
      residentRunners.set(chat.chatKey, runner);
      return runner;
    }

    // 群聊：每条消息新建 agent，用完销毁；有后台任务则等任务结束再销毁。
    // clear 空实现：每消息新建 agent，无跨消息持久上下文（见 PopoAgentRunner 注释）。
    // askBtw：问「正在处理消息的 agent」实时进度；无正在处理的消息则返回提示。
    return {
      clear: async () => undefined,
      askBtw: async (question) => {
        const agent = activeAgents.get(chat.chatKey);
        if (!agent) return TEAM_BTW_IDLE;
        return agent.askBtw?.(question) ?? TEAM_BTW_IDLE;
      },
      run: (content) =>
        serialized(chat.chatKey, async () => {
          const { agent } = await createSdkAgent(chat);
          activeAgents.set(chat.chatKey, agent);
          const loggerKey = `popo-${sanitizeSessionId(chat.chatKey)}`;
          try {
            return await runTurn(agent, chat, content);
          } finally {
            activeAgents.delete(chat.chatKey);
            if (agent.hasRunningBackgroundWork?.()) {
              // 注册到共享调度器：任务结束后统一销毁，不阻塞本次回复。
              scheduleDisposeWhenSettled(agent, loggerKey);
            } else {
              try {
                await agent.dispose();
              } catch {
                // dispose 失败不能掩盖回复结果。
              } finally {
                closeAgentLogger(loggerKey);
              }
            }
          }
        }),
    };
  };
}
