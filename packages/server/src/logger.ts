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
};

function resolveLevel(override?: string): string {
  const raw = (override ?? process.env.MUSE_LOG_LEVEL ?? "info").toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw) ? raw : "info";
}

export function resolveLogDir(home?: string): string {
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
    fs.mkdirSync(dir, { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: path.join(dir, "server.log"),
        maxsize: MAX_SIZE_BYTES,
        maxFiles: MAX_FILES,
        tailable: true,
      }),
    );
  }

  return winston.createLogger({
    level: resolveLevel(options?.level),
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
