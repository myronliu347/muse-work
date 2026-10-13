import { serve } from "@hono/node-server";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import type { AppContext } from "../services/appContext.js";
import { getLogger } from "../utils/logger.js";
import { createCallbackApp } from "./callbackApp.js";
import { createPopoHandler } from "./handler.js";
import { recordPopoMasterInbound } from "../services/assistant/popoTranscript.js";
import { loadPopoConfig, type PopoConfig } from "./popoConfig.js";
import { createSender, type Sender } from "./sender.js";
import { createTokenStore } from "./tokenStore.js";

export type PopoRuntime = {
  config: PopoConfig;
  callbackPort: number;
  ready: boolean;
  error?: string;
  url: string;
  /** 本地是否存在 popo 配置（~/.popo-config.json）；缺失时前端不显示回调配置 */
  configured: boolean;
  /** 主动发文本（定时任务通知、助理回复）；未配置时缺省。 */
  sendText?: Sender["sendText"];
  /** 上传本地文件或图片后发给接收人。 */
  sendLocalFile?: Sender["sendLocalFile"];
  recall?: Sender["recall"];
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

export function setupPopoRuntime(ctx: AppContext, options?: { callbackPort?: number }): PopoRuntime {
  const logger = getLogger();
  const callbackPort = options?.callbackPort ?? Number(process.env.POPO_CALLBACK_PORT ?? 3100);
  const ip = getLanIPv4() ?? "127.0.0.1";
  const url = `http://${ip}:${callbackPort}/popo/callback`;

  let config: PopoConfig;
  try {
    config = loadPopoConfig(ctx.home);
  } catch (error) {
    logger.error("popo disabled: config unavailable", { error: String(error) });
    return {
      config: null as unknown as PopoConfig,
      callbackPort,
      ready: false,
      error: String(error),
      url,
      configured: false,
    };
  }

  const runtime: PopoRuntime = {
    config,
    callbackPort,
    ready: false,
    url,
    configured: true,
  };

  const tokenStore = createTokenStore({
    home: ctx.home,
    appKey: config.appKey,
    appSecret: config.appSecret,
  });
  const sender = createSender({ tokenStore });
  runtime.sendText = (receiver, content) => sender.sendText(receiver, content);
  runtime.sendLocalFile = (receiver, filePath) => sender.sendLocalFile(receiver, filePath);
  runtime.recall = (args) => sender.recall(args);
  if (runtime.sendText) ctx.popoSend.current = runtime.sendText;
  if (runtime.sendLocalFile) ctx.popoSend.sendLocalFile = runtime.sendLocalFile;
  if (runtime.recall) ctx.popoSend.recall = runtime.recall;
  const handler = createPopoHandler({
    config,
    sender,
    logger,
    onChat: (event) => {
      recordPopoMasterInbound(ctx.assistantLog, ctx.hub, event);
      ctx.assistantRuntime.enqueue({ type: "chat", ...event });
    },
  });
  const app = createCallbackApp({
    config,
    handler,
    logger,
    ...(process.env.POPO_DEBUG_DUMP === "1"
      ? { debugFile: path.join(getMuseHomeDir(ctx.home), "popo-callback-debug.jsonl") }
      : {}),
  });

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
