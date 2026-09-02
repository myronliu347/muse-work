#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { createApp } from "./app.js";
import type { ChatStore } from "./popo/chatStore.js";
import { loadPopoConfig, type PopoConfig } from "./popo/popoConfig.js";
import { getLanIPv4, setupPopoRuntime, type PopoRuntime } from "./popo/setup.js";
import { createAppContext } from "./services/appContext.js";
import { configureLogger, resolveLogDir } from "./utils/logger.js";
import { installRuntimeStats } from "./utils/runtimeStats.js";
import { installGracefulShutdown } from "./utils/shutdown.js";

const HOST = "127.0.0.1";

function parsePort(argv: string[]): number {
  const idx = argv.indexOf("--port");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  const envPort = process.env.MUSE_SERVER_PORT;
  if (envPort) {
    const n = Number(envPort);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  return 0;
}

const port = parsePort(process.argv.slice(2));
const ctx = createAppContext();
// configureLogger 必须先于 setupPopoRuntime：popo 启动/降级日志要写入
// ctx.home 下的日志文件，而不是 getLogger() 提前创建默认 logger 时的 os.homedir()。
const log = configureLogger({ home: ctx.home });
const callbackPort = Number(process.env.POPO_CALLBACK_PORT ?? 3100);

/** 本地是否已配置 popo（~/.popo-config.json 可加载）——仅用于端口冲突跳过分支的入口显示。 */
function configFileExists(): boolean {
  try {
    loadPopoConfig(ctx.home);
    return true;
  } catch {
    return false;
  }
}

let popo: PopoRuntime;
if (port !== 0 && port === callbackPort) {
  // 主端口恰好等于 popo 回调端口：若此时 setupPopoRuntime 先绑 0.0.0.0:3100，
  // 主 server 再 listen 127.0.0.1:3100 会 EADDRINUSE 崩溃。按 spec 决策跳过
  // popo，主 server 照常启动。
  log.warn("popo disabled: callback port conflicts with main server port", {
    port: callbackPort,
  });
  popo = {
    config: null as unknown as PopoConfig,
    chatStore: null as unknown as ChatStore,
    callbackPort,
    ready: false,
    error: `popo 回调端口与主 server 端口冲突（${callbackPort}），已跳过`,
    url: `http://${getLanIPv4() ?? "127.0.0.1"}:${callbackPort}/popo/callback`,
    workdir: path.join(ctx.home, "popo-chat"),
    configured: configFileExists(),
  };
} else {
  popo = setupPopoRuntime(ctx);
}
ctx.popo = popo;

const server = createApp(ctx);
installGracefulShutdown({
  runner: ctx.runner,
  hub: ctx.hub,
  server,
  log,
});

const srv = server.listen(port, HOST, () => {
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    log.error("failed to bind server");
    process.exit(1);
  }
  process.env.MUSE_SERVER_URL = `http://${HOST}:${addr.port}`;
  process.env.MUSE_SERVER_PORT = String(addr.port);
  // 外部 shell 读不到进程内 env：把实际地址落盘到 MUSE_HOME 下固定文件。
  const serverUrlFile = path.join(getMuseHomeDir(ctx.home), "server-url");
  fs.writeFileSync(serverUrlFile, `http://${HOST}:${addr.port}`);
  // Desktop parses this single JSON line from stdout for the ready port.
  process.stdout.write(
    `${JSON.stringify({ ready: true, port: addr.port, host: HOST })}\n`,
  );
  log.info("server listening", {
    host: HOST,
    port: addr.port,
    logDir: resolveLogDir(ctx.home),
  });
  // 周期性打内存/存活计数，崩溃前在 server.log 里留下增长曲线（V8 OOM 观测）。
  installRuntimeStats({
    store: ctx.store,
    getAgentCount: () => ctx.runner.getAgentCount(),
    getClientCount: () => ctx.hub.clientCount(),
    log,
  });
});
// 绑定失败（端口占用等）时输出清晰日志后退出，替代未处理 'error' 事件的裸崩溃。
srv.on("error", (err) => {
  log.error("main server bind failed", { error: String(err) });
  process.exit(1);
});
