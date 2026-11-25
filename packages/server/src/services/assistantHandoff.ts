import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { getLogger } from "../utils/logger.js";
import { resolveAssistantWorkdir } from "./assistant/session.js";
import type { createAssistantMessageLog } from "./assistant/messages.js";
import type { Issue, IssueStore } from "./issueStore.js";
import type { IssueProgressStore, IssueUpdate } from "./issueProgress.js";
import type { WsHub } from "./wsHub.js";

/**
 * 每日收工交接。
 *
 * 收工时把「现在在跟什么、今天有什么动静、明天先做什么、等你拍板什么」
 * 写进助手工作目录的 HANDOFF.md，同时归档聊天记录、清空助手上下文，再把
 * 交接作为系统注记注入新上下文。第二天助手从交接继续，不用背着几轮压缩。
 *
 * 开关默认开启；手动「立即收工」不受开关限制。
 */

export const ASSISTANT_HANDOFF_VERSION = 1;
export const ASSISTANT_HANDOFF_DEFAULT_ENABLED = true;
export const ASSISTANT_HANDOFF_DEFAULT_HOUR = 4;

const MAX_ISSUES = 12;
const MAX_UPDATES = 10;
const MAX_MESSAGES = 4;
const MAX_LINE = 180;
const MAX_HANDOFF_CHARS = 16_000;
const ASK_TIMEOUT_MS = 180_000;
const MIN_HANDOFF_CHARS = 80;
const HANDOFF_FILE = "HANDOFF.md";
const JOURNAL_DIR = "JOURNAL";
const HANDOFF_NOTICE_PREFIX = "【自动交接】";

export interface AssistantHandoffConfig {
  version: 1;
  enabled: boolean;
  hour: number;
  lastRunAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export interface AssistantHandoffState extends AssistantHandoffConfig {
  nextRunAt: number;
  working: boolean;
  handoffPath: string;
  handoff: string | null;
  archiveRoot: string;
}

export type AssistantHandoffTrigger = "manual" | "schedule";

export type AssistantHandoffRunResult =
  | {
      ok: true;
      handoff: string;
      handoffPath: string;
      archiveDir?: string;
      skipped?: "no_activity";
      notice?: string;
    }
  | { ok: false; error: string; busy?: boolean };

type HandoffSession = {
  id: string;
  origin?: "user" | "automation" | "assistant";
  workdir: string;
  status?: string;
  lastActiveAt?: number;
};

type HandoffRunner = {
  clear(sessionId: string): Promise<{ ok: true }>;
  appendSystemNote(sessionId: string, content: string): Promise<void>;
  isCompacting(sessionId: string): boolean;
  /** 单轮 fork：复用助手上下文/模型，但不产生可见回合，也不调用工具。 */
  askBtw?(
    sessionId: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<string>;
};

type HandoffLog = Pick<
  ReturnType<typeof createAssistantMessageLog>,
  "page" | "clear" | "append"
>;

export interface AssistantHandoffOptions {
  home: string;
  sessions: { list(): HandoffSession[] };
  runner: HandoffRunner;
  issues: Pick<IssueStore, "listActive">;
  issueProgress: Pick<IssueProgressStore, "latest" | "list">;
  assistantLog: HandoffLog;
  hub: Pick<WsHub, "broadcastAll">;
  /** 助手的运行时是否正在处理或队列里还有事件。 */
  isBusy?: () => boolean;
  /** 交接期间暂停助手事件泵；返回 false 表示刚好有回合在跑。 */
  beginAssistantExclusive?: () => boolean;
  endAssistantExclusive?: () => void;
  now?: () => Date;
}

export interface AssistantHandoffService {
  getConfig(): AssistantHandoffConfig;
  getState(): AssistantHandoffState;
  update(patch: { enabled?: boolean; hour?: number }): AssistantHandoffState;
  assistantSession(): HandoffSession | undefined;
  markAttempt(): void;
  run(trigger: AssistantHandoffTrigger): Promise<AssistantHandoffRunResult>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待规划",
  planning: "规划中",
  executing: "执行中",
  review: "待审核",
  awaiting_close: "待关闭",
  completed: "已完成",
  cancelled: "已取消",
};

const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2 };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function localHourStart(date: Date, hour: number): number {
  const start = new Date(date);
  start.setHours(hour, 0, 0, 0);
  return start.getTime();
}

export function nextAssistantHandoffAt(
  config: Pick<AssistantHandoffConfig, "hour">,
  now: Date,
): number {
  const today = localHourStart(now, config.hour);
  if (today > now.getTime()) return today;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(config.hour, 0, 0, 0);
  return tomorrow.getTime();
}

export function assistantHandoffConfigPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "assistant-handoff.json");
}

export function assistantMessagesDir(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "assistant-messages");
}

export function assistantMessagesArchiveRoot(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "assistant-messages-archive");
}

function normalizeConfig(raw: unknown): AssistantHandoffConfig {
  const base: AssistantHandoffConfig = {
    version: ASSISTANT_HANDOFF_VERSION,
    enabled: ASSISTANT_HANDOFF_DEFAULT_ENABLED,
    hour: ASSISTANT_HANDOFF_DEFAULT_HOUR,
  };
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Record<string, unknown>;
  const enabled =
    typeof value.enabled === "boolean" ? value.enabled : base.enabled;
  const hour =
    typeof value.hour === "number" &&
    Number.isInteger(value.hour) &&
    value.hour >= 0 &&
    value.hour <= 23
      ? value.hour
      : base.hour;
  const lastRunAt =
    typeof value.lastRunAt === "number" && Number.isFinite(value.lastRunAt)
      ? value.lastRunAt
      : undefined;
  const lastAttemptAt =
    typeof value.lastAttemptAt === "number" &&
    Number.isFinite(value.lastAttemptAt)
      ? value.lastAttemptAt
      : undefined;
  const lastError =
    typeof value.lastError === "string" && value.lastError.trim()
      ? value.lastError.trim()
      : undefined;
  return {
    version: ASSISTANT_HANDOFF_VERSION,
    enabled,
    hour,
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

export function loadAssistantHandoffConfig(home: string): AssistantHandoffConfig {
  const file = assistantHandoffConfigPath(home);
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return normalizeConfig(undefined);
  }
}

export function saveAssistantHandoffConfig(
  home: string,
  config: AssistantHandoffConfig,
): void {
  const file = assistantHandoffConfigPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function oneLine(text: string, max = MAX_LINE): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chars = [...collapsed];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : collapsed;
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

function writeAtomically(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export interface HandoffIssueFacts {
  issue: Issue;
  latest?: IssueUpdate;
  updates: IssueUpdate[];
}

export function collectHandoffFacts(args: {
  issues: Issue[];
  issueProgress: Pick<IssueProgressStore, "latest" | "list">;
  since: number;
}): HandoffIssueFacts[] {
  return args.issues.map((issue) => {
    const latest = args.issueProgress.latest(issue.id);
    const listed = args.issueProgress.list(issue.id, { limit: 30 }).updates;
    return {
      issue,
      ...(latest ? { latest } : {}),
      updates: listed.filter((update) => update.at > args.since),
    };
  });
}

export function buildHandoffMaterial(args: {
  facts: HandoffIssueFacts[];
  messages: Array<{
    at: number;
    role: "user" | "assistant";
    message: string;
  }>;
}): string {
  const sorted = [...args.facts].sort((a, b) => {
    const priority =
      (PRIORITY_RANK[a.issue.priority] ?? 9) -
      (PRIORITY_RANK[b.issue.priority] ?? 9);
    return priority !== 0 ? priority : b.issue.updatedAt - a.issue.updatedAt;
  });

  const updates = sorted
    .flatMap(({ issue, updates: issueUpdates }) =>
      issueUpdates.map((update) => ({ issue, update })),
    )
    .sort((a, b) => b.update.at - a.update.at)
    .slice(0, MAX_UPDATES);

  const waiting = sorted.filter(
    ({ issue }) =>
      issue.status === "review" ||
      issue.status === "awaiting_close" ||
      issue.replyPending,
  );

  const nextSteps: string[] = [];
  for (const { issue, latest } of sorted) {
    const next = latest?.next?.trim();
    if (!next) continue;
    if (nextSteps.some((item) => item === next)) continue;
    nextSteps.push(next);
    if (nextSteps.length >= 3) break;
  }
  if (nextSteps.length === 0) {
    for (const { issue } of sorted.slice(0, 3)) nextSteps.push(issue.title);
  }

  const lastWords = args.messages
    .filter((message) => !message.message.startsWith(HANDOFF_NOTICE_PREFIX))
    .slice(-MAX_MESSAGES)
    .map(
      (message) =>
        `- ${message.role === "user" ? "他" : "我"}：${oneLine(message.message, 140)}`,
    );

  const sections: string[] = [];
  sections.push(
    [
      `## 现在在跟（${args.facts.length}）`,
      sorted.length === 0
        ? "（没有在跟的事项）"
        : sorted
            .slice(0, MAX_ISSUES)
            .map(({ issue, latest }) => {
              const status = STATUS_LABEL[issue.status] ?? issue.status;
              const done = issue.items.filter(
                (item) => item.status === "done",
              ).length;
              const checklist =
                issue.items.length > 0
                  ? ` · 清单 ${done}/${issue.items.length}`
                  : "";
              const head = `- **${issue.priority} · ${oneLine(issue.title, 80)}**（\`${issue.id}\`）· ${status}${checklist}`;
              const lines = [head];
              if (latest?.summary) {
                lines.push(`  - 最新：${oneLine(latest.summary)}`);
              }
              if (latest?.next) {
                lines.push(`  - 下一步：${oneLine(latest.next)}`);
              }
              return lines.join("\n");
            })
            .join("\n"),
    ].join("\n\n"),
  );

  sections.push(
    [
      "## 今天有动静",
      updates.length === 0
        ? "（没有新进展）"
        : updates
            .map(
              ({ issue, update }) =>
                `- ${clock(new Date(update.at))} ${oneLine(issue.title, 40)}：${oneLine(update.summary)}`,
            )
            .join("\n"),
    ].join("\n\n"),
  );

  sections.push(
    [
      "## 等你拍板",
      waiting.length === 0
        ? "（没有等你拍板的）"
        : waiting
            .map(({ issue }) => {
              const label =
                issue.status === "review"
                  ? "待审核"
                  : issue.status === "awaiting_close"
                    ? "待关闭"
                    : "等你回话";
              return `- ${oneLine(issue.title, 80)}：${label}`;
            })
            .join("\n"),
    ].join("\n\n"),
  );

  sections.push(
    [
      "## 明天先做",
      nextSteps.length === 0
        ? "（没有明确下一步，先看台账）"
        : nextSteps.map((item, index) => `${index + 1}. ${oneLine(item)}`).join("\n"),
    ].join("\n\n"),
  );

  if (lastWords.length > 0) {
    sections.push(["## 最近对话", lastWords.join("\n")].join("\n\n"));
  }

  return clip(sections.join("\n\n"), MAX_HANDOFF_CHARS);
}

export function buildHandoffPrompt(now: Date, material: string): string {
  return `这是系统收工流程，不是普通旁路提问。现在收工，请写一份交接给明天的新上下文（也就是下一个你）。

要求：
- 直接输出 markdown 正文，第一行是 \`# 交接 · ${dayKey(now)} ${clock(now)}\`。
- 写给下一个自己看：短、具体、可执行；不要对用户说话，不要客套。
- 至少包含：现在在跟什么、今天做到哪、明天先做什么、等你拍板/等外部、会过期但明天要用的临时上下文。
- 控制在 1200 字以内；不写完整 Issue 描述、不写密钥、不复制工具输出。
- 直接输出正文。不要调用 SendMessage，不要调用任何工具，不要解释你在做什么。

下面是一份机器整理的事实素材，可能不全，以对话上下文为准：

${material}`;
}

export function normalizeModelHandoff(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  if (
    /^(no response received|no response|error:|\(the model tried to call|this is a side question)/i.test(
      text,
    )
  ) {
    return "";
  }
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  if (fenced) text = fenced[1]!.trim();
  if (!text) return "";
  return clip(text, MAX_HANDOFF_CHARS);
}

function copyAssistantMessages(
  home: string,
  destDir: string,
): { files: number } {
  const source = assistantMessagesDir(home);
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(source)
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
  } catch {
    return { files: 0 };
  }
  if (names.length === 0) return { files: 0 };
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of names) {
    fs.copyFileSync(path.join(source, name), path.join(destDir, name));
  }
  return { files: names.length };
}

function readText(file: string, max = 20_000): string | null {
  try {
    const content = fs.readFileSync(file, "utf8");
    return content.length > max ? content.slice(0, max) : content;
  } catch {
    return null;
  }
}

export function createAssistantHandoff(
  options: AssistantHandoffOptions,
): AssistantHandoffService {
  const now = () => options.now?.() ?? new Date();
  let running = false;

  const getConfig = () => loadAssistantHandoffConfig(options.home);

  const assistantSession = () =>
    options.sessions.list().find((session) => session.origin === "assistant");

  const save = (config: AssistantHandoffConfig) => {
    saveAssistantHandoffConfig(options.home, config);
  };

  const markAttempt = () => {
    save({
      ...getConfig(),
      lastAttemptAt: now().getTime(),
    });
  };

  const getState = (): AssistantHandoffState => {
    const config = getConfig();
    const session = assistantSession();
    const workdir =
      session?.workdir?.trim() || resolveAssistantWorkdir(options.home);
    const handoffPath = path.join(workdir, HANDOFF_FILE);
    return {
      ...config,
      nextRunAt: nextAssistantHandoffAt(config, now()),
      working: Boolean(options.isBusy?.()),
      handoffPath,
      handoff: readText(handoffPath),
      archiveRoot: assistantMessagesArchiveRoot(options.home),
    };
  };

  const update = (patch: { enabled?: boolean; hour?: number }) => {
    const current = getConfig();
    const next: AssistantHandoffConfig = { ...current };
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.hour !== undefined) {
      if (
        !Number.isInteger(patch.hour) ||
        patch.hour < 0 ||
        patch.hour > 23
      ) {
        throw new Error("hour must be an integer between 0 and 23");
      }
      next.hour = patch.hour;
    }
    save(next);
    return getState();
  };

  const run = async (
    trigger: AssistantHandoffTrigger,
  ): Promise<AssistantHandoffRunResult> => {
    if (running) {
      return { ok: false, error: "收工正在进行", busy: true };
    }
    const config = getConfig();
    if (trigger === "schedule" && !config.enabled) {
      return { ok: false, error: "每日收工已关闭" };
    }

    const session = assistantSession();
    if (!session) {
      return { ok: false, error: "助手会话还没创建" };
    }
    if (session.status === "running") {
      return { ok: false, error: "助手正在处理事情，等这一轮结束再收工", busy: true };
    }
    if (options.runner.isCompacting(session.id)) {
      return { ok: false, error: "助手正在压缩上下文，稍后再收工", busy: true };
    }
    if (options.isBusy?.()) {
      return { ok: false, error: "助手还有事件在排队，等它处理完再收工", busy: true };
    }

    running = true;
    let exclusive = false;
    const at = now();
    const atMs = at.getTime();
    const since = config.lastRunAt ?? 0;
    const displaySince = config.lastRunAt ?? atMs - 24 * 60 * 60 * 1000;

    try {
      const active = options.issues.listActive();
      const facts = collectHandoffFacts({
        issues: active,
        issueProgress: options.issueProgress,
        since: displaySince,
      });
      const recentMessages = options.assistantLog.page({ limit: 50 }).messages;
      const updatesSince = facts.flatMap((fact) => fact.updates);
      const hasActivity =
        recentMessages.some(
          (message) =>
            message.at > since &&
            !message.message.startsWith(HANDOFF_NOTICE_PREFIX),
        ) ||
        active.some((issue) => issue.updatedAt > since) ||
        updatesSince.length > 0;

      if (trigger === "schedule" && !hasActivity) {
        save({ ...config, lastAttemptAt: atMs });
        return {
          ok: true,
          handoff: "",
          handoffPath: "",
          skipped: "no_activity",
        };
      }

      const messages = recentMessages.filter(
        (message) => message.at > displaySince,
      );
      const material = buildHandoffMaterial({ facts, messages });
      const prompt = buildHandoffPrompt(at, material);

      if (options.beginAssistantExclusive) {
        if (!options.beginAssistantExclusive()) {
          return {
            ok: false,
            error: "助手刚好开始处理事情，稍后再收工",
            busy: true,
          };
        }
        exclusive = true;
      }

      let raw: string;
      try {
        if (!options.runner.askBtw) {
          throw new Error("当前运行时不支持助手写交接");
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
        try {
          raw = await options.runner.askBtw(session.id, prompt, controller.signal);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const message =
          err instanceof Error && err.name === "AbortError"
            ? "助手写交接超时"
            : err instanceof Error
              ? err.message
              : String(err);
        save({ ...config, lastAttemptAt: atMs, lastError: message });
        return {
          ok: false,
          error: `助手没写成交接，本次没有清空上下文：${message}`,
        };
      }

      const markdown = normalizeModelHandoff(raw);
      if (!markdown || markdown.length < MIN_HANDOFF_CHARS) {
        const message =
          markdown.length > 0 && markdown.length < MIN_HANDOFF_CHARS
            ? "助手写回的交接太短"
            : "助手没有写回交接正文";
        save({ ...config, lastAttemptAt: atMs, lastError: message });
        return {
          ok: false,
          error: `助手没写成交接，本次没有清空上下文：${message}`,
        };
      }

      const workdir =
        session.workdir?.trim() || resolveAssistantWorkdir(options.home);
      const handoffPath = path.join(workdir, HANDOFF_FILE);
      writeAtomically(handoffPath, markdown);

      const journalDir = path.join(workdir, JOURNAL_DIR);
      fs.mkdirSync(journalDir, { recursive: true });
      fs.appendFileSync(
        path.join(journalDir, `${dayKey(at)}.md`),
        `${markdown}\n`,
        "utf8",
      );

      const archiveRoot = assistantMessagesArchiveRoot(options.home);
      const archiveDir = path.join(archiveRoot, stamp(at));
      const archived = copyAssistantMessages(options.home, archiveDir);
      if (archived.files > 0) {
        writeAtomically(
          path.join(archiveDir, "meta.json"),
          `${JSON.stringify(
            {
              at: atMs,
              trigger,
              handoffPath,
              messages: archived.files,
            },
            null,
            2,
          )}\n`,
        );
      }

      try {
        await options.runner.clear(session.id);
      } catch (err) {
        save({
          ...config,
          lastAttemptAt: atMs,
          lastError: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          error: `清空助手上下文失败：${err instanceof Error ? err.message : String(err)}`,
          ...(String(err).includes("running") ? { busy: true } : {}),
        };
      }

      options.assistantLog.clear();
      options.hub.broadcastAll({ type: "assistant:cleared" });

      const noticeLine = options.assistantLog.append(
        "assistant",
        `${HANDOFF_NOTICE_PREFIX}已收工。交接写在 \`${handoffPath}\`，明天从这里继续。`,
      );
      options.hub.broadcastAll({ type: "assistant:chat", line: noticeLine });
      options.hub.broadcastAll({
        type: "assistant:handoff",
        at: atMs,
        trigger,
        summary: oneLine(markdown.split("\n")[0] ?? "已收工"),
      });

      let warning: string | undefined;
      try {
        await options.runner.appendSystemNote(
          session.id,
          `【收工交接】这是你在 ${dayKey(at)} ${clock(at)} 收工时写下的交接，先看它再处理今天的事。需要回看原文时 Read \`${handoffPath}\`。\n\n${markdown}`,
        );
      } catch (err) {
        warning = `交接已写入文件，但注入新上下文失败：${err instanceof Error ? err.message : String(err)}`;
      }

      save({
        ...config,
        lastRunAt: atMs,
        lastAttemptAt: atMs,
        lastError: warning,
      });

      return {
        ok: true,
        handoff: markdown,
        handoffPath,
        ...(archived.files > 0 ? { archiveDir } : {}),
        ...(warning ? { notice: warning } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().warn("assistant handoff failed", { error: message });
      save({ ...config, lastAttemptAt: atMs, lastError: message });
      return { ok: false, error: `收工失败：${message}` };
    } finally {
      running = false;
      if (exclusive) options.endAssistantExclusive?.();
    }
  };

  return {
    getConfig,
    getState,
    update,
    assistantSession,
    markAttempt,
    run,
  };
}

export interface AssistantHandoffScheduler {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

const TICK_MS = 30_000;
const MAX_DELAY_HOURS = 12;

export function createAssistantHandoffScheduler(options: {
  service: AssistantHandoffService;
  now?: () => Date;
  intervalMs?: number;
  maxDelayHours?: number;
  onError?: (error: unknown) => void;
}): AssistantHandoffScheduler {
  const now = () => options.now?.() ?? new Date();
  const intervalMs = options.intervalMs ?? TICK_MS;
  const maxDelayMs = (options.maxDelayHours ?? MAX_DELAY_HOURS) * 60 * 60 * 1000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    const config = options.service.getConfig();
    if (!config.enabled) return;
    const current = now();
    const at = current.getTime();
    const start = localHourStart(current, config.hour);
    if (at < start) return;
    if ((config.lastAttemptAt ?? 0) >= start) return;
    if (at - start > maxDelayMs) {
      options.service.markAttempt();
      return;
    }
    const session = options.service.assistantSession();
    if (!session) {
      options.service.markAttempt();
      return;
    }
    // 今天已经开始用了（或助手被事件叫醒过），就别在用户眼皮底下换班。
    if ((session.lastActiveAt ?? 0) > start) {
      options.service.markAttempt();
      return;
    }
    ticking = true;
    try {
      await options.service.run("schedule");
    } catch (err) {
      options.onError?.(err);
    } finally {
      ticking = false;
    }
  };

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
