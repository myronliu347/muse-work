import fs from "node:fs";
import path from "node:path";
import type { ProviderRegistry } from "@muse-work/provider";
import { defaultCreateAgent, type CreateAgent, type SessionAgent } from "../services/sessionRunner/index.js";
import { pluginDirIfPresent } from "../services/museSettings.js";
import { closeAgentLogger, createAgentLogger } from "../utils/logger.js";
import type { PopoChatType } from "./chatStore.js";

export const POPO_SYSTEM_PROMPT = `你是 Muse 机器人，运行在 POPO 即时通讯上，为你的人类主人服务。

- 消息可能来自私聊或群聊。群聊消息开头可能带 "@机器人名 "，这是群成员 @ 你，正文才是需要你处理的内容。
- 当消息来自群聊时，如果上下文不完整（例如用户提到群里的历史讨论），可以使用本地 popo-cli（popo-im skill）读取该群的历史消息来补全上下文。
- 回复保持简洁、直接，使用中文。
- 只有主人可以直接指挥你；其他人发来的请求一律礼貌拒绝。
- 禁止后台任务：不要使用 Bash 的 run_in_background 参数，所有命令必须前台执行并等待完成；不要创建定时任务（cron）。你收不到后台任务完成的通知，后台任务只会白跑。`;

/** POPO 机器人禁用的工具：Workflow 在后台运行、完成后才有通知，本场景无法接收结果。 */
export const POPO_DISALLOWED_TOOLS = ["Workflow"] as const;

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
  const residentRunners = new Map<string, PopoAgentRunner>();
  /** 同一 chat 的消息串行执行（常驻 agent / 共享 session 都要求按序）。 */
  const serialChains = new Map<string, Promise<unknown>>();
  /** chatKey → 当前正在处理消息的 agent（team 每消息新建，run 期间登记，供 /btw 实时询问）。 */
  const activeAgents = new Map<string, SessionAgent>();

  async function createSdkAgent(
    chat: { chatKey: string; type: PopoChatType; waveSessionId?: string },
  ): Promise<SessionAgent> {
    fs.mkdirSync(workdir, { recursive: true });
    const active = options.registry.getActive();
    const provider = options.registry.get(active.providerId);
    if (!provider) throw new Error(`active provider not found: ${active.providerId}`);
    const model = active.modelId ?? (await provider.listModels())[0]?.id;
    if (!model) throw new Error("no active model");
    const gateway = await provider.resolveGateway(model);

    // 内置 todo 插件（普通会话也挂载；POPO 会话里说「记个 todo」也能创建）
    const todoDir = pluginDirIfPresent("todo");
    const plugins = todoDir
      ? [{ type: "local" as const, path: todoDir }]
      : [];

    return (createAgent as CreateAgent)({
      apiKey: gateway.apiKey,
      baseURL: gateway.baseURL,
      defaultHeaders: gateway.defaultHeaders,
      fetch: gateway.fetch,
      model: gateway.model,
      fastModel: gateway.fastModel ?? gateway.model,
      workdir,
      stream: true,
      permissionMode: "bypassPermissions",
      systemPrompt: POPO_SYSTEM_PROMPT,
      // Workflow 后台运行且结果通知本场景收不到，硬禁用
      disallowedTools: [...POPO_DISALLOWED_TOOLS],
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
      const agent = await createSdkAgent(chat);
      residentAgents.set(chat.chatKey, agent);
      const runner: PopoAgentRunner = {
        run: (content) => serialized(chat.chatKey, () => runTurn(agent, chat, content)),
        // 与 run 同链串行：等正在跑的消息结束后再清，避免上下文交错。
        clear: () =>
          serialized(chat.chatKey, async () => {
            await agent.clearMessages?.();
            return "";
          }).then(() => undefined),
        // 不走 serialized 串行链：SDK askBtw 是旁路 fork，不打断主 turn，
        // 基于当前上下文实时回答（无工具、不写消息、不落盘）。
        askBtw: (question) => agent.askBtw?.(question) ?? Promise.resolve(TEAM_BTW_IDLE),
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
          const agent = await createSdkAgent(chat);
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
