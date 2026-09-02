import type { Server as HttpServer } from "node:http";

export type ShutdownLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export type GracefulShutdownOpts = {
  runner: { shutdown: () => Promise<{ aborted: number }> };
  hub: { close: () => void };
  server: Pick<HttpServer, "close">;
  log?: ShutdownLogger;
  exit?: (code: number) => void;
  /** 关闭前同步钩子。 */
  onShutdown?: () => void;
};

export async function gracefulShutdown(
  opts: GracefulShutdownOpts,
): Promise<void> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  try {
    opts.onShutdown?.();
    const result = await opts.runner.shutdown();
    opts.log?.info("server shutting down", { aborted: result.aborted });
    opts.hub.close();
    await new Promise<void>((resolve, reject) => {
      opts.server.close((err) => (err ? reject(err) : resolve()));
    });
    exit(0);
  } catch (err) {
    opts.log?.error("graceful shutdown failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    exit(1);
  }
}

export type InstallGracefulShutdownOpts = GracefulShutdownOpts & {
  process?: Pick<NodeJS.Process, "on">;
};

export function installGracefulShutdown(
  opts: InstallGracefulShutdownOpts,
): void {
  const proc = opts.process ?? process;
  let shuttingDown = false;
  const onSignal = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void gracefulShutdown(opts);
  };
  proc.on("SIGTERM", onSignal);
  proc.on("SIGINT", onSignal);
}
