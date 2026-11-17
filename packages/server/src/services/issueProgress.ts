import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import type { IssueStatus } from "./issueStore.js";

export const ISSUE_UPDATE_LIMIT = 30;
export const ISSUE_UPDATE_COMPACT_AT = 80;
export const ISSUE_PROGRESS_MAX_BYTES = 262_144;
export const ISSUE_UPDATE_SUMMARY_MAX = 280;
export const ISSUE_UPDATE_DETAIL_MAX = 2_000;
export const ISSUE_UPDATE_FILES_MAX = 10;

export type IssueUpdateKind =
  | "assistant"
  | "turn"
  | "status"
  | "checklist"
  | "permission"
  | "result";

export interface IssueUpdate {
  id: string;
  /** 毫秒时间戳。 */
  at: number;
  kind: IssueUpdateKind;
  /** 时间线直接显示的一两句话。turn 只放系统模板。 */
  summary: string;
  /** 可选全文；只在展开时显示。 */
  detail?: string;
  sessionId?: string;
  /** assistant-messages 里的聊天行 id，用于跳回聊天。 */
  messageId?: string;
  /** turn 专用：这一轮最后一条 session 消息 id。 */
  sessionMessageId?: string;
  /** turn 专用：这一轮改动的代码文件，点击看 diff。 */
  changedFiles?: string[];
  files?: string[];
  /** 这一步的下一步，一句话。 */
  next?: string;
  /** 落这条时的 Issue 状态。 */
  status?: IssueStatus;
  /** 去重键：重试、重放不会重复追加。 */
  sourceKey?: string;
  /** assistant 本轮 id；P1 回执卡按它分组。 */
  turnId?: string;
  /** 审批进度：等待批准的那次 permission 请求 id。 */
  permissionId?: string;
  /** 用户正看着这个会话时产生，不计未读。 */
  userPresent?: true;
}

/** 写入时不能传 id / at；由 store 生成。 */
export type IssueUpdateInput = Omit<IssueUpdate, "id" | "at">;

export interface IssueProgressStore {
  append(issueId: string, input: IssueUpdateInput): IssueUpdate | undefined;
  list(
    issueId: string,
    opts?: { limit?: number; before?: string },
  ): { updates: IssueUpdate[]; hasMore: boolean };
  latest(issueId: string): IssueUpdate | undefined;
  /** 当前保留的条数；压缩后最多 ISSUE_UPDATE_LIMIT。 */
  count(issueId: string): number;
}

type CacheEntry = {
  updates: IssueUpdate[];
  total: number;
  sourceKeys: Set<string>;
  bytes: number;
};

const ISSUE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function progressDir(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "issue-progress");
}

function progressFile(home: string, issueId: string): string {
  return path.join(progressDir(home), `${issueId}.jsonl`);
}

function clipCodePoints(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= max) break;
  }
  return result;
}

function normalizeInput(input: IssueUpdateInput): IssueUpdateInput | undefined {
  const summary = clipCodePoints(input.summary?.trim() ?? "", ISSUE_UPDATE_SUMMARY_MAX);
  if (!summary) return undefined;
  const detail = input.detail?.trim();
  return {
    kind: input.kind,
    summary,
    ...(detail
      ? { detail: clipCodePoints(detail, ISSUE_UPDATE_DETAIL_MAX) }
      : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.sessionMessageId
      ? { sessionMessageId: input.sessionMessageId }
      : {}),
    ...(input.changedFiles
      ? { changedFiles: stringList(input.changedFiles, 20) }
      : {}),
    ...(input.files
      ? { files: stringList(input.files, ISSUE_UPDATE_FILES_MAX) }
      : {}),
    ...(input.next ? { next: clipCodePoints(input.next.trim(), 280) } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.sourceKey ? { sourceKey: input.sourceKey.trim() } : {}),
    ...(input.turnId ? { turnId: input.turnId.trim() } : {}),
    ...(input.permissionId ? { permissionId: input.permissionId.trim() } : {}),
    ...(input.userPresent ? { userPresent: true as const } : {}),
  };
}

function parseUpdate(raw: string): IssueUpdate | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed) as Partial<IssueUpdate>;
    if (!value || typeof value !== "object") return undefined;
    if (typeof value.id !== "string" || !value.id) return undefined;
    if (typeof value.at !== "number" || !Number.isFinite(value.at)) return undefined;
    if (
      value.kind !== "assistant" &&
      value.kind !== "turn" &&
      value.kind !== "status" &&
      value.kind !== "checklist" &&
      value.kind !== "permission" &&
      value.kind !== "result"
    ) {
      return undefined;
    }
    if (typeof value.summary !== "string") return undefined;
    const normalized = normalizeInput({
      kind: value.kind,
      summary: value.summary,
      ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
      ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
      ...(typeof value.messageId === "string" ? { messageId: value.messageId } : {}),
      ...(typeof value.sessionMessageId === "string"
        ? { sessionMessageId: value.sessionMessageId }
        : {}),
      ...(Array.isArray(value.changedFiles)
        ? { changedFiles: value.changedFiles }
        : {}),
      ...(Array.isArray(value.files) ? { files: value.files } : {}),
      ...(typeof value.next === "string" ? { next: value.next } : {}),
      ...(value.status ? { status: value.status } : {}),
      ...(typeof value.sourceKey === "string" ? { sourceKey: value.sourceKey } : {}),
      ...(typeof value.turnId === "string" ? { turnId: value.turnId } : {}),
      ...(typeof value.permissionId === "string"
        ? { permissionId: value.permissionId }
        : {}),
      ...(value.userPresent === true ? { userPresent: true as const } : {}),
    });
    if (!normalized) return undefined;
    return { ...normalized, id: value.id, at: value.at };
  } catch {
    return undefined;
  }
}

function cloneUpdate(update: IssueUpdate): IssueUpdate {
  return {
    ...update,
    ...(update.files ? { files: [...update.files] } : {}),
    ...(update.changedFiles ? { changedFiles: [...update.changedFiles] } : {}),
  };
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * 同一轮里助手会连着发几条 `SendMessage`（提示词要求「两三个不同的意思分成几次
 * 短的发」），它们各写一条 assistant 进展时，时间线会变成同一次汇报的几段碎行。
 * 合并成一条：第一句是这一轮的结论，后续内容进 `detail`（展开全文），`next`
 * 取最新一句，文件与 `at` 沿用第一条。
 */
function mergeAssistantTurn(
  previous: IssueUpdate,
  next: IssueUpdateInput,
): IssueUpdate {
  const bodies = [previous.detail ?? previous.summary, next.detail ?? next.summary]
    .map((body) => body.trim())
    .filter(Boolean);
  const files = stringList(
    [...(previous.files ?? []), ...(next.files ?? [])],
    ISSUE_UPDATE_FILES_MAX,
  );
  // 两条都短时把第二句也放进摘要，时间线一行就读得完；第一句已经很长则只保留它，
  // 第二句留在全文里。
  const joined = `${previous.summary} ${next.summary}`.trim();
  const summary =
    joined.length <= ISSUE_UPDATE_SUMMARY_MAX && !previous.detail
      ? joined
      : previous.summary;
  return {
    ...previous,
    summary,
    detail: clipCodePoints(bodies.join("\n\n"), ISSUE_UPDATE_DETAIL_MAX),
    ...(files.length > 0 ? { files } : {}),
    ...(next.messageId ? { messageId: next.messageId } : {}),
    ...(next.next ? { next: next.next } : {}),
    ...(next.status ? { status: next.status } : {}),
    ...(next.userPresent ? { userPresent: true as const } : {}),
  };
}

/** 把连续的、同一轮的 assistant 进展折成一条（读旧文件与合并新写入共用）。 */
function foldAssistantTurns(updates: IssueUpdate[]): IssueUpdate[] {
  const folded: IssueUpdate[] = [];
  for (const update of updates) {
    const last = folded[folded.length - 1];
    if (
      last?.kind === "assistant" &&
      update.kind === "assistant" &&
      last.turnId &&
      last.turnId === update.turnId
    ) {
      folded[folded.length - 1] = mergeAssistantTurn(last, update);
      continue;
    }
    folded.push(update);
  }
  return folded;
}

/** 重写文件里 `id` 对应的那一行（合并同一轮的多条助手进展时用）。 */
function replaceUpdateLine(filePath: string, update: IssueUpdate): boolean {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  let replaced = false;
  const lines = raw.split("\n").filter((line) => line.trim());
  const next = lines.map((line) => {
    if (replaced) return line;
    try {
      const parsed = JSON.parse(line) as { id?: unknown };
      if (parsed.id !== update.id) return line;
    } catch {
      return line;
    }
    replaced = true;
    return JSON.stringify(update);
  });
  if (!replaced) return false;
  writeAtomically(filePath, next.map((line) => `${line}\n`).join(""));
  return true;
}

export function createIssueProgressStore(options: {
  home: string;
  now?: () => number;
  newId?: () => string;
}): IssueProgressStore {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const cache = new Map<string, CacheEntry>();

  function load(issueId: string): CacheEntry {
    const cached = cache.get(issueId);
    if (cached) return cached;
    const empty: CacheEntry = {
      updates: [],
      total: 0,
      sourceKeys: new Set(),
      bytes: 0,
    };
    const filePath = progressFile(options.home, issueId);
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      cache.set(issueId, empty);
      return empty;
    }
    const parsed: IssueUpdate[] = [];
    for (const line of raw.split("\n")) {
      const update = parseUpdate(line);
      if (update) parsed.push(update);
    }
    parsed.sort((a, b) => a.at - b.at);
    const folded = foldAssistantTurns(parsed);
    // 旧文件里同一轮的几条助手消息各占一行；读到的第一次就折成一条并写回，
    // 否则这条 Issue 的时间线会一直显示成两次进展。
    if (folded.length !== parsed.length) {
      const content = folded
        .map((update) => `${JSON.stringify(update)}\n`)
        .join("");
      writeAtomically(filePath, content);
      raw = content;
    }
    const entry: CacheEntry = {
      updates: folded.slice(-ISSUE_UPDATE_LIMIT).map(cloneUpdate),
      total: folded.length,
      sourceKeys: new Set(
        folded.flatMap((update) => (update.sourceKey ? [update.sourceKey] : [])),
      ),
      bytes: Buffer.byteLength(raw),
    };
    cache.set(issueId, entry);
    return entry;
  }

  function compact(issueId: string, entry: CacheEntry): void {
    const keep = entry.updates.slice(-ISSUE_UPDATE_LIMIT).map(cloneUpdate);
    const content = keep.map((update) => `${JSON.stringify(update)}\n`).join("");
    writeAtomically(progressFile(options.home, issueId), content);
    entry.updates = keep;
    entry.total = keep.length;
    entry.sourceKeys = new Set(
      keep.flatMap((update) => (update.sourceKey ? [update.sourceKey] : [])),
    );
    entry.bytes = Buffer.byteLength(content);
  }

  return {
    append(issueId, input) {
      if (!ISSUE_ID.test(issueId)) return undefined;
      const normalized = normalizeInput(input);
      if (!normalized) return undefined;
      const entry = load(issueId);
      if (normalized.sourceKey) {
        const existing = entry.updates.find(
          (update) => update.sourceKey === normalized.sourceKey,
        );
        if (existing) return cloneUpdate(existing);
        if (entry.sourceKeys.has(normalized.sourceKey)) return undefined;
      }
      // 同一轮的多条助手消息只占一条进展。
      const previous = entry.updates.at(-1);
      if (
        normalized.kind === "assistant" &&
        normalized.turnId &&
        previous?.kind === "assistant" &&
        previous.turnId === normalized.turnId
      ) {
        const merged = mergeAssistantTurn(previous, normalized);
        if (replaceUpdateLine(progressFile(options.home, issueId), merged)) {
          entry.updates[entry.updates.length - 1] = cloneUpdate(merged);
          entry.bytes +=
            Buffer.byteLength(JSON.stringify(merged)) -
            Buffer.byteLength(JSON.stringify(previous));
          return cloneUpdate(merged);
        }
      }
      const update: IssueUpdate = {
        ...normalized,
        id: newId(),
        at: now(),
      };
      const line = `${JSON.stringify(update)}\n`;
      fs.mkdirSync(progressDir(options.home), { recursive: true });
      fs.appendFileSync(progressFile(options.home, issueId), line, "utf8");
      entry.updates.push(cloneUpdate(update));
      entry.updates = entry.updates.slice(-ISSUE_UPDATE_LIMIT);
      entry.total += 1;
      entry.bytes += Buffer.byteLength(line);
      if (update.sourceKey) entry.sourceKeys.add(update.sourceKey);
      if (
        entry.total > ISSUE_UPDATE_COMPACT_AT ||
        entry.bytes > ISSUE_PROGRESS_MAX_BYTES
      ) {
        compact(issueId, entry);
      }
      return cloneUpdate(update);
    },

    list(issueId, opts) {
      if (!ISSUE_ID.test(issueId)) return { updates: [], hasMore: false };
      const entry = load(issueId);
      const limit = Math.min(
        Math.max(1, Math.floor(opts?.limit ?? ISSUE_UPDATE_LIMIT)),
        ISSUE_UPDATE_LIMIT,
      );
      // entry.updates 始终按写入顺序（旧→新）；直接反转比按 at 排序更稳，
      // 同一毫秒写入的两条也不会被 sort 的稳定顺序留在旧在前。
      const newestFirst = [...entry.updates].reverse();
      let start = 0;
      if (opts?.before) {
        const index = newestFirst.findIndex((update) => update.id === opts.before);
        start = index === -1 ? 0 : index + 1;
      }
      const updates = newestFirst.slice(start, start + limit).map(cloneUpdate);
      return {
        updates,
        hasMore: entry.total - start > updates.length,
      };
    },

    latest(issueId) {
      if (!ISSUE_ID.test(issueId)) return undefined;
      const entry = load(issueId);
      const latest = entry.updates.at(-1);
      return latest ? cloneUpdate(latest) : undefined;
    },

    count(issueId) {
      if (!ISSUE_ID.test(issueId)) return 0;
      return load(issueId).total;
    },
  };
}
