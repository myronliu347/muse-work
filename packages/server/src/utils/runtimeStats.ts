import type { SessionStore } from "../services/sessionStore.js";
import { getLogger } from "./logger.js";

export const DEFAULT_RUNTIME_STATS_INTERVAL_MS = 60_000;

export type RuntimeStatsLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
};

export type RuntimeStatsOptions = {
  store: Pick<SessionStore, "list">;
  /** Number of live session agents (long-lived agents hold conversation state). */
  getAgentCount: () => number;
  /** Number of connected WebSocket clients across all sessions. */
  getClientCount: () => number;
  log?: RuntimeStatsLogger;
  intervalMs?: number;
  schedule?: typeof setInterval;
  clearSchedule?: typeof clearInterval;
  memoryUsage?: () => NodeJS.MemoryUsage;
};

export type RuntimeStats = {
  /** Stop the periodic sampling. */
  stop: () => void;
};

/**
 * Periodically log process memory + live counters so memory growth (e.g. the
 * V8 heap OOM that killed a long-running server) is visible in server.log
 * before the process dies. Samples once immediately on install.
 */
export function installRuntimeStats(
  options: RuntimeStatsOptions,
): RuntimeStats {
  const intervalMs = options.intervalMs ?? DEFAULT_RUNTIME_STATS_INTERVAL_MS;
  const log = options.log ?? getLogger();
  const schedule = options.schedule ?? setInterval;
  const clearSchedule = options.clearSchedule ?? clearInterval;
  const memoryUsage = options.memoryUsage ?? process.memoryUsage.bind(process);

  const sample = (): void => {
    const mem = memoryUsage();
    log.info("runtime stats", {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      sessions: options.store.list().length,
      agents: options.getAgentCount(),
      wsClients: options.getClientCount(),
    });
  };

  sample();
  const timer = schedule(sample, intervalMs);
  return {
    stop: () => clearSchedule(timer),
  };
}
