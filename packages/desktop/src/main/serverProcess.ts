import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHealthWatch, type CreateHealthWatchOpts } from "./healthWatch";

export type MuseServerLifecycle =
  | {
      state: "restarting";
      restart: number;
      maxRestarts: number;
      code: number | null;
      signal: NodeJS.Signals | null;
    }
  | {
      state: "ready";
      restart: number;
      maxRestarts: number;
      port: number;
      host: string;
    }
  | {
      state: "failed";
      restart: number;
      maxRestarts: number;
      error: string;
    }
  | {
      state: "dead";
      maxRestarts: number;
      code: number | null;
      signal: NodeJS.Signals | null;
    };

export type StartMuseServerOpts = {
  entry: string;
  host?: string;
  /** Max unexpected-exit restarts (default 3). */
  maxRestarts?: number;
  /** Base backoff ms between restarts (default 500). */
  restartBackoffMs?: number;
  /** How long to wait for the ready JSON line (default 15000). */
  readyTimeoutMs?: number;
  /** Override node binary (tests / custom PATH). */
  nodeBinary?: string;
  env?: NodeJS.ProcessEnv;
  onLifecycle?: (event: MuseServerLifecycle) => void;
  /**
   * Poll GET /health and kill the child after consecutive failures so the
   * existing restart path can recover a hung (but still alive) process.
   * Default on, except under Vitest.
   */
  healthWatch?: boolean | Omit<CreateHealthWatchOpts, "getUrl" | "onUnhealthy">;
};

export type MuseServerHandle = {
  port: number;
  host: string;
  stop: () => Promise<void>;
  probeHealth: () => Promise<boolean>;
  /** SIGTERM the child without flipping `stopping`, so crash-restart still runs. */
  killUnhealthy: () => void;
};

type ReadyPayload = {
  ready?: boolean;
  port?: number;
  host?: string;
};

const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_READY_TIMEOUT_MS = 15_000;

function resolveNodeBinary(override?: string): string {
  if (override) return override;
  return process.execPath;
}

function spawnEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  // When the desktop runs under Electron, execPath is the Electron binary.
  // ELECTRON_RUN_AS_NODE makes it behave like Node for the server entry.
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
}

function parseReadyLine(line: string): ReadyPayload | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as ReadyPayload;
    if (parsed && parsed.ready === true && typeof parsed.port === "number") {
      return parsed;
    }
  } catch {
    // ignore non-JSON lines
  }
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn Muse HTTP server (`node entry --port 0` on first start), parse the
 * ready JSON line from stdout, and optionally restart on unexpected crash
 * with backoff. Restarts reuse the first ready port so the webview URL stays valid.
 */
export async function startMuseServer(
  opts: StartMuseServerOpts,
): Promise<MuseServerHandle> {
  const maxRestarts = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const backoffMs = opts.restartBackoffMs ?? DEFAULT_BACKOFF_MS;
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const nodeBinary = resolveNodeBinary(opts.nodeBinary);
  const preferredHost = opts.host ?? "127.0.0.1";
  const healthWatchEnabled =
    opts.healthWatch === false
      ? false
      : opts.healthWatch === true || typeof opts.healthWatch === "object"
        ? true
        : process.env.VITEST === undefined;

  let child: ChildProcess | null = null;
  let stopping = false;
  let restarts = 0;
  let currentPort = 0;
  let currentHost = preferredHost;
  let stdoutBuf = "";

  const health = createHealthWatch({
    ...(typeof opts.healthWatch === "object" ? opts.healthWatch : {}),
    getUrl: () => `${museServerBaseUrl(currentPort, currentHost)}/health`,
    onUnhealthy: () => {
      if (stopping) return;
      console.error("[muse-desktop] server health check failed; restarting");
      health.stop();
      if (child && child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
    },
  });

  const stopChild = async (): Promise<void> => {
    const c = child;
    child = null;
    if (!c || c.exitCode !== null || c.killed) return;
    c.kill("SIGTERM");
    const exited = Promise.race([
      once(c, "exit").then(() => undefined),
      wait(3000).then(() => {
        if (c.exitCode === null && !c.killed) c.kill("SIGKILL");
      }),
    ]);
    await exited;
  };

  const spawnOnce = (): Promise<{ port: number; host: string }> =>
    new Promise((resolve, reject) => {
      stdoutBuf = "";
      const portArg = currentPort > 0 ? String(currentPort) : "0";
      const args = [opts.entry, "--port", portArg];
      const c = spawn(nodeBinary, args, {
        env: spawnEnv(opts.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = c;

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void stopChild();
        reject(new Error(`muse server ready timeout after ${readyTimeoutMs}ms`));
      }, readyTimeoutMs);

      const finishOk = (port: number, host: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        currentPort = port;
        currentHost = host;
        resolve({ port, host });
      };

      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };

      if (!c.stdout || !c.stderr) {
        finishErr(new Error("muse server spawn missing stdio pipes"));
        return;
      }

      c.stdout.setEncoding("utf8");
      c.stdout.on("data", (chunk: string) => {
        stdoutBuf += chunk;
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
          const ready = parseReadyLine(line);
          if (ready && typeof ready.port === "number") {
            finishOk(ready.port, ready.host ?? preferredHost);
            return;
          }
        }
      });

      c.stderr.setEncoding("utf8");
      c.stderr.on("data", (chunk: string) => {
        // Surface server logs in desktop terminal; keep quiet in tests.
        if (!process.env.VITEST) {
          process.stderr.write(chunk);
        }
      });

      c.on("error", (err) => {
        finishErr(err);
      });

      c.on("exit", (code, signal) => {
        if (settled) {
          // Unexpected crash after ready — restart with backoff.
          if (!stopping) {
            void (async () => {
              if (restarts >= maxRestarts) {
                console.error(
                  `[muse-desktop] server exited (code=${code} signal=${signal}); max restarts reached`,
                );
                opts.onLifecycle?.({
                  state: "dead",
                  maxRestarts,
                  code,
                  signal,
                });
                return;
              }
              restarts += 1;
              const delay = backoffMs * restarts;
              console.error(
                `[muse-desktop] server exited (code=${code} signal=${signal}); restart ${restarts}/${maxRestarts} in ${delay}ms`,
              );
              opts.onLifecycle?.({
                state: "restarting",
                restart: restarts,
                maxRestarts,
                code,
                signal,
              });
              health.stop();
              await wait(delay);
              if (stopping) return;
              try {
                const next = await spawnOnce();
                if (healthWatchEnabled) health.start();
                opts.onLifecycle?.({
                  state: "ready",
                  restart: restarts,
                  maxRestarts,
                  port: next.port,
                  host: next.host,
                });
              } catch (err) {
                console.error("[muse-desktop] server restart failed:", err);
                opts.onLifecycle?.({
                  state: "failed",
                  restart: restarts,
                  maxRestarts,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            })();
          }
          return;
        }
        finishErr(
          new Error(
            `muse server exited before ready (code=${code} signal=${signal})`,
          ),
        );
      });
    });

  const first = await spawnOnce();
  if (healthWatchEnabled) health.start();

  return {
    port: first.port,
    host: first.host,
    stop: async () => {
      stopping = true;
      health.stop();
      await stopChild();
    },
    probeHealth: () => health.probeNow(),
    killUnhealthy: () => {
      if (stopping) return;
      health.stop();
      if (child && child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
    },
  };
}

/** Build the HTTP base URL the webview should call. */
export function museServerBaseUrl(port: number, host = "127.0.0.1"): string {
  return `http://${host}:${port}`;
}
