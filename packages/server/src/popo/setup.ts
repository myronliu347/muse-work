import { serve } from "@hono/node-server";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { AppContext } from "../services/appContext.js";
import type { CreateAgent } from "../services/sessionRunner.js";
import { getLogger } from "../utils/logger.js";
import { createCallbackApp } from "./callbackApp.js";
import { createChatStore, type ChatStore } from "./chatStore.js";
import { createPopoHandler } from "./handler.js";
import { createPopoAgentFactory } from "./popoAgent.js";
import { loadPopoConfig, type PopoConfig } from "./popoConfig.js";
import { createSender } from "./sender.js";
import { createTokenStore } from "./tokenStore.js";

export type PopoRuntime = {
  config: PopoConfig;
  chatStore: ChatStore;
  callbackPort: number;
  ready: boolean;
  error?: string;
  url: string;
  /** 机器人 agent 工作目录（session 文件即存在该目录下，详情路由据此读取完整消息） */
  workdir: string;
  /** 本地是否存在 popo 配置（~/.popo-config.json）；缺失时前端不显示机器人入口 */
  configured: boolean;
};

export function getLanIPv4(): string | undefined {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal && name.startsWith("en")) {
        return net.address;
      }
    }
  }
  return undefined;
}

export type SetupPopoOptions = {
  callbackPort?: number;
  createAgent?: CreateAgent;
};

export function setupPopoRuntime(ctx: AppContext, options?: SetupPopoOptions): PopoRuntime {
  const logger = getLogger();
  const callbackPort = options?.callbackPort ?? Number(process.env.POPO_CALLBACK_PORT ?? 3100);
  const ip = getLanIPv4() ?? "127.0.0.1";
  const url = `http://${ip}:${callbackPort}/popo/callback`;
  // 机器人 agent 工作目录（popoAgent 与详情路由共用，须保持一致）
  const popoWorkdir = path.join(ctx.home, "popo-chat");

  let config: PopoConfig;
  try {
    config = loadPopoConfig(ctx.home);
  } catch (error) {
    logger.error("popo disabled: config unavailable", { error: String(error) });
    return {
      config: null as unknown as PopoConfig,
      chatStore: null as unknown as ChatStore,
      callbackPort,
      ready: false,
      error: String(error),
      url,
      workdir: popoWorkdir,
      configured: false,
    };
  }

  const chatStore = createChatStore({ home: ctx.home });
  const runtime: PopoRuntime = { config, chatStore, callbackPort, ready: false, url, workdir: popoWorkdir, configured: true };

  const tokenStore = createTokenStore({
    home: ctx.home,
    appKey: config.appKey,
    appSecret: config.appSecret,
  });
  const sender = createSender({ tokenStore });
  const agentFactory = createPopoAgentFactory({
    home: ctx.home,
    workdir: popoWorkdir,
    registry: ctx.registry,
    createAgent: options?.createAgent,
    onWaveSessionId: (chatKey, waveSessionId) => {
      chatStore.setWaveSessionId(chatKey, waveSessionId);
    },
  });
  const handler = createPopoHandler({ config, chatStore, sender, agentFactory, logger });
  const app = createCallbackApp({
    config,
    handler,
    logger,
    // 调试落盘默认关闭（原始请求含消息内容与鉴权 token）；设 POPO_DEBUG_DUMP=1 开启
    ...(process.env.POPO_DEBUG_DUMP === "1"
      ? { debugFile: path.join(ctx.home, ".muse-work", "popo-callback-debug.jsonl") }
      : {}),
  });

  // 隔离性硬约束：回调监听失败只降级，不影响主 server。
  try {
    const server = serve(
      { fetch: app.fetch, hostname: "0.0.0.0", port: callbackPort },
      () => {
        runtime.ready = true;
        logger.info("popo callback listening", { port: callbackPort, url });
      },
    );
    server.on("error", (error) => {
      runtime.ready = false;
      runtime.error = String(error);
      logger.error("popo callback bind failed (popo degraded, muse unaffected)", {
        error: String(error),
      });
    });
  } catch (error) {
    runtime.ready = false;
    runtime.error = String(error);
    logger.error("popo callback start failed (popo degraded, muse unaffected)", {
      error: String(error),
    });
  }

  return runtime;
}
