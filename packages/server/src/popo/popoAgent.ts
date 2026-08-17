import fs from "node:fs";
import path from "node:path";
import type { ProviderRegistry } from "@muse-work/provider";
import { defaultCreateAgent, type CreateAgent } from "../services/sessionRunner.js";
import { createAgentLogger } from "../utils/logger.js";
import type { PopoChatType } from "./chatStore.js";

export const POPO_SYSTEM_PROMPT = `你是 Muse 机器人，运行在 POPO 即时通讯上，为你的人类主人服务。

- 消息可能来自私聊或群聊。群聊消息开头可能带 "@机器人名 "，这是群成员 @ 你，正文才是需要你处理的内容。
- 当消息来自群聊时，如果上下文不完整（例如用户提到群里的历史讨论），可以使用本地 popo-cli（popo-im skill）读取该群的历史消息来补全上下文。
- 回复保持简洁、直接，使用中文。
- 只有主人可以直接指挥你；其他人发来的请求一律礼貌拒绝。`;

export interface PopoAgentRunner {
  run(content: string): Promise<string>;
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

export function createPopoAgentFactory(options: PopoAgentFactoryOptions): PopoAgentFactory {
  const createAgent = options.createAgent ?? defaultCreateAgent;
  /** 机器人 agent 工作目录：~/popo-chat（用户指定，与主会话 workdir 隔离） */
  const workdir = options.workdir ?? path.join(options.home, "popo-chat");

  return async (chat) => {
    fs.mkdirSync(workdir, { recursive: true });
    const active = options.registry.getActive();
    const provider = options.registry.get(active.providerId);
    if (!provider) throw new Error(`active provider not found: ${active.providerId}`);
    const model = active.modelId ?? (await provider.listModels())[0]?.id;
    if (!model) throw new Error("no active model");
    const gateway = await provider.resolveGateway(model);

    const agent = await (createAgent as CreateAgent)({
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

    return {
      async run(content) {
        try {
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
        } finally {
          // 每条消息一个 SDK Agent，用完即销毁。上下文已通过 restoreSessionId
          // 持久化到 chatStore，dispose 不影响后续续聊。
          try {
            await agent.dispose();
          } catch {
            // dispose 失败不能掩盖回复结果。
          }
        }
      },
    };
  };
}
