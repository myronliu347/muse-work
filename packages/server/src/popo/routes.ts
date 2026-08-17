import { Hono } from "hono";
import { loadSessionFromJsonl } from "wave-agent-sdk";
import type { SessionData } from "wave-agent-sdk";
import type { PopoRuntime } from "./setup.js";

export type PopoRoutesOptions = {
  /** 读取 agent session 消息的注入点（测试用）；默认用 SDK 从 workdir 的 session 文件读取。 */
  loadSession?: (sessionId: string, workdir: string) => Promise<SessionData | null>;
};

export function createPopoRoutes(runtime: PopoRuntime, options?: PopoRoutesOptions): Hono {
  const app = new Hono();
  const loadSession = options?.loadSession ?? loadSessionFromJsonl;

  app.get("/popo/config", (c) =>
    c.json({
      url: runtime.url,
      token: runtime.config?.token ?? null,
      aesKey: runtime.config?.aesKey ?? null,
      masterUid: runtime.config?.masterUid ?? null,
      port: runtime.callbackPort,
      ready: runtime.ready,
      /** 本地存在 popo 配置（~/.popo-config.json）；缺失时前端隐藏机器人入口 */
      configured: runtime.configured,
      error: runtime.error ?? null,
    }),
  );

  app.get("/popo/chats", (c) =>
    c.json({
      chats: runtime.chatStore?.listChats().map((chat) => ({
        chatKey: chat.chatKey,
        type: chat.type,
        title: chat.title,
        lastMessage: chat.messages[chat.messages.length - 1]?.content ?? "",
        processing: chat.processing ?? false,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      })) ?? [],
    }),
  );

  app.get("/popo/chats/:chatKey", async (c) => {
    const chat = runtime.chatStore?.getChat(decodeURIComponent(c.req.param("chatKey")));
    if (!chat) return c.json({ error: "chat not found" }, 404);

    let messages: Array<{ id: string; role: string; blocks: unknown[]; isMeta?: boolean }> = [];
    if (chat.waveSessionId && runtime.workdir) {
      try {
        const loaded = await loadSession(chat.waveSessionId, runtime.workdir);
        const loadedMessages = loaded?.messages ?? [];
        if (loadedMessages.length > 0) {
          // 完整处理过程：来自 agent session 文件，含 reasoning/tool/text 全部块。
          // 过滤 isMeta（"会话已创建"之类噪音），其余原样返回给前端用 Message 组件渲染。
          messages = loadedMessages.filter((m) => !m.isMeta);
        }
      } catch (error) {
        // session 文件缺失/损坏：回退到 chatStore 的文本摘要。
      }
    }
    if (messages.length === 0) {
      messages = chat.messages.map((m, i) => ({
        id: `${chat.chatKey}:${i}`,
        role: m.role,
        blocks: [{ type: "text", content: m.content }],
      }));
    }

    return c.json({ chat: { ...chat, processing: chat.processing ?? false }, messages });
  });

  return app;
}
