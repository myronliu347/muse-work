import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

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
};

export type MuseServerHandle = {
  port: number;
  host: string;
  stop: () => Promise<void>;
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
 * Spawn Muse HTTP server (`node entry --port 0`), parse the ready JSON line
 * from stdout, and optionally restart on unexpected crash with backoff.
 */
export async function startMuseServer(
  opts: StartMuseServerOpts,
): Promise<MuseServerHandle> {
  const maxRestarts = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const backoffMs = opts.restartBackoffMs ?? DEFAULT_BACKOFF_MS;
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const nodeBinary = resolveNodeBinary(opts.nodeBinary);
  const preferredHost = opts.host ?? "127.0.0.1";

  let child: ChildProcess | null = null;
  let stopping = false;
  let restarts = 0;
  let currentPort = 0;
  let currentHost = preferredHost;
  let stdoutBuf = "";

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
      const args = [opts.entry, "--port", "0"];
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
                return;
              }
              restarts += 1;
              const delay = backoffMs * restarts;
              console.error(
                `[muse-desktop] server exited (code=${code} signal=${signal}); restart ${restarts}/${maxRestarts} in ${delay}ms`,
              );
              await wait(delay);
              if (stopping) return;
              try {
                await spawnOnce();
              } catch (err) {
                console.error("[muse-desktop] server restart failed:", err);
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

  return {
    port: first.port,
    host: first.host,
    stop: async () => {
      stopping = true;
      await stopChild();
    },
  };
}

/** Build the HTTP base URL the webview should call. */
export function museServerBaseUrl(port: number, host = "127.0.0.1"): string {
  return `http://${host}:${port}`;
}
