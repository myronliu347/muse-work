#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir, loadDeepSeekEnv } from "@muse-work/provider";
import { createApp } from "./app.js";
import { openHostedAppContext, resolveHome } from "./services/appContext.js";
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

async function main(): Promise<void> {
  loadDeepSeekEnv();
  // 先按 ctx.home 配好文件 logger，再加载宿主插件：syncNeteasePlugin 和插件
  // start 的日志（popo 回调地址、绑定失败）都要写进同一个文件。
  const home = resolveHome();
  const log = configureLogger({ home });
  const ctx = await openHostedAppContext({ home });
  await ctx.startHostPlugins(port);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
