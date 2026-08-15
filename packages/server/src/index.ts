#!/usr/bin/env node
import { createApp } from "./app.js";
import { createAppContext } from "./services/appContext.js";
import { configureLogger, resolveLogDir } from "./utils/logger.js";
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
const log = configureLogger({ home: ctx.home });
const server = createApp(ctx);
installGracefulShutdown({
  runner: ctx.runner,
  hub: ctx.hub,
  server,
  log,
});

server.listen(port, HOST, () => {
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    log.error("failed to bind server");
    process.exit(1);
  }
  // Desktop parses this single JSON line from stdout for the ready port.
  process.stdout.write(
    `${JSON.stringify({ ready: true, port: addr.port, host: HOST })}\n`,
  );
  log.info("server listening", {
    host: HOST,
    port: addr.port,
    logDir: resolveLogDir(ctx.home),
  });
});
