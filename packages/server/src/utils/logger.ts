import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import winston from "winston";

const LOG_LEVELS = ["error", "warn", "info", "http", "verbose", "debug", "silly"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

export type CreateLoggerOptions = {
  /** Parent of `.muse-work/` (same as `MUSE_HOME` / `os.homedir()`). */
  home?: string;
  /** Override log level (default: `MUSE_LOG_LEVEL` or `info`). */
  level?: string;
  /** Skip file transport (tests). Also set when `MUSE_LOG_FILE=0`. */
  disableFile?: boolean;
  /** Silence all transports (tests). Default true under `VITEST`. */
  silent?: boolean;
  /** Log file name under `logs/` (default: `server-YYYY-MM-DD.log`). */
  fileName?: string;
  /** Fields attached to every line (e.g. sessionId). */
  defaultMeta?: Record<string, unknown>;
};

/** SDK `Logger` surface (`wave-agent-sdk`). */
export type AgentLogger = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

function resolveLevel(override?: string): string {
  const raw = (override ?? process.env.MUSE_LOG_LEVEL ?? "info").toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw) ? raw : "info";
}

export function resolveLogDir(home?: string): string {
  // MUSE_LOG_DIR lets the desktop host point a dev instance's server logs at a
  // separate directory (userData/logs) so they don't interleave with the
  // packaged app's logs.
  if (process.env.MUSE_LOG_DIR) return process.env.MUSE_LOG_DIR;
  const root = home ?? process.env.MUSE_HOME ?? os.homedir();
  return path.join(root, ".muse-work", "logs");
}

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const textFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...rest } = info;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // Winston splat / Symbol keys — skip non-plain meta.
      if (typeof key !== "string" || key.startsWith("Symbol(")) continue;
      parts.push(`${key}=${formatValue(value)}`);
    }
    const meta = parts.length > 0 ? ` ${parts.join(" ")}` : "";
    const head = `[${String(timestamp)}] ${String(level).toUpperCase()} ${String(message)}${meta}`;
    return stack ? `${head}\n${String(stack)}` : head;
  }),
);

function shouldDisableFile(options?: CreateLoggerOptions): boolean {
  if (options?.disableFile !== undefined) return options.disableFile;
  if (process.env.MUSE_LOG_FILE === "0") return true;
  // Avoid writing into the real home while unit tests run.
  if (process.env.VITEST !== undefined && process.env.MUSE_LOG_TEST !== "1") {
    return true;
  }
  return false;
}

/** Default server log file name with a local-date suffix (server-2026-08-18.log). */
export function defaultLogFileName(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `server-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
}

export function createLogger(options?: CreateLoggerOptions): winston.Logger {
  const silentConsole =
    options?.silent ??
    (process.env.VITEST !== undefined && process.env.MUSE_LOG_TEST !== "1");
  const disableFile = shouldDisableFile(options);

  const transports: winston.transport[] = [
    new winston.transports.Stream({
      stream: process.stderr,
      silent: silentConsole,
    }),
  ];

  if (!disableFile) {
    const dir = resolveLogDir(options?.home);
    const filename = path.join(dir, options?.fileName ?? defaultLogFileName());
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    transports.push(
      new winston.transports.File({
        filename,
        maxsize: MAX_SIZE_BYTES,
        maxFiles: MAX_FILES,
        tailable: true,
      }),
    );
  }

  return winston.createLogger({
    level: resolveLevel(options?.level),
    defaultMeta: options?.defaultMeta,
    format: textFormat,
    transports,
  });
}

let shared: winston.Logger | undefined;

/** Process-wide logger; call `configureLogger` once at startup with home. */
export function getLogger(): winston.Logger {
  if (!shared) {
    shared = createLogger();
  }
  return shared;
}

export function configureLogger(options?: CreateLoggerOptions): winston.Logger {
  if (shared) {
    shared.close();
  }
  shared = createLogger(options);
  return shared;
}

const agentLoggers = new Map<string, winston.Logger>();

function formatSdkMessage(args: unknown[]): string {
  return args
    .map((value) => {
      if (value instanceof Error) {
        return value.stack ?? value.message;
      }
      if (typeof value === "string") {
        return value;
      }
      return formatValue(value);
    })
    .join(" ")
    .trim();
}

/**
 * Per-session logger passed into `Agent.create({ logger })`.
 * Writes SDK runtime logs to `logs/sessions/<sessionId>.log` (debug+)
 * and mirrors info/warn/error onto the process logger.
 */
export function createAgentLogger(options: {
  home: string;
  sessionId: string;
  disableFile?: boolean;
  silent?: boolean;
  level?: string;
}): AgentLogger {
  closeAgentLogger(options.sessionId);
  const sessionId = options.sessionId;
  const fileLog = createLogger({
    home: options.home,
    silent: options.silent ?? true,
    disableFile: options.disableFile,
    fileName: path.join("sessions", `${sessionId}.log`),
    defaultMeta: { sessionId, source: "agent" },
    level: options.level ?? process.env.MUSE_AGENT_LOG_LEVEL ?? "debug",
  });
  agentLoggers.set(sessionId, fileLog);

  const emit =
    (level: "error" | "warn" | "info" | "debug") =>
    (...args: unknown[]): void => {
      const message = formatSdkMessage(args);
      if (!message) return;
      fileLog[level](message);
      if (level === "debug") return;
      getLogger()[level](message, { sessionId, source: "agent" });
    };

  return {
    error: emit("error"),
    warn: emit("warn"),
    info: emit("info"),
    debug: emit("debug"),
  };
}

export function closeAgentLogger(sessionId: string): void {
  const log = agentLoggers.get(sessionId);
  if (!log) return;
  agentLoggers.delete(sessionId);
  log.close();
}
