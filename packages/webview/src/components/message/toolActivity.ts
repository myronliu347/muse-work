import { diffLines } from "diff";
import {
  AGENT_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "@muse-work/agent/constants";
import type { MessageBlock, ReasoningBlock, ToolBlock } from "../../types";

export type AssistantSegment =
  | { type: "single"; index: number }
  | { type: "activity"; indexes: number[] };

export interface ActivitySummary {
  label: string;
  additions: number;
  deletions: number;
}

type BangBlock = Extract<MessageBlock, { type: "bang" }>;

function parseParams(block: ToolBlock): Record<string, unknown> {
  if (!block.parameters) return {};
  try {
    const parsed = JSON.parse(block.parameters) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Streaming parameters are incomplete JSON.
  }
  return {};
}

function stringParam(
  params: Record<string, unknown>,
  key: string,
): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function lineDelta(
  before: string,
  after: string,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before, after)) {
    const count = part.count ?? 0;
    if (part.added) additions += count;
    else if (part.removed) deletions += count;
  }
  return { additions, deletions };
}

export function toolStats(block: ToolBlock): {
  additions: number;
  deletions: number;
} {
  if (block.error || block.success === false) {
    return { additions: 0, deletions: 0 };
  }
  const params = parseParams(block);
  if (
    block.name === WRITE_TOOL_NAME &&
    typeof params.content === "string"
  ) {
    return lineDelta("", params.content);
  }
  if (
    block.name === EDIT_TOOL_NAME &&
    typeof params.old_string === "string" &&
    typeof params.new_string === "string"
  ) {
    return lineDelta(params.old_string, params.new_string);
  }
  return { additions: 0, deletions: 0 };
}

function kindOf(name?: string): "file" | "search" | "edit" | "run" | "browser" | "other" {
  if (name === READ_TOOL_NAME) return "file";
  if (name === GREP_TOOL_NAME || name === GLOB_TOOL_NAME || name === "WebSearch") {
    return "search";
  }
  if (name === EDIT_TOOL_NAME || name === WRITE_TOOL_NAME) return "edit";
  if (name === BASH_TOOL_NAME) return "run";
  if (
    name === WEB_FETCH_TOOL_NAME ||
    (name ? /browser|navigate/i.test(name) : false)
  ) {
    return "browser";
  }
  return "other";
}

export function toolLineLabel(block: ToolBlock): string {
  const params = parseParams(block);
  const name = block.name || "Tool";
  if (name === READ_TOOL_NAME) {
    const path = stringParam(params, "file_path");
    const base = path ? baseName(path) : block.compactParams || name;
    const offset = typeof params.offset === "number" ? params.offset : undefined;
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    if (offset !== undefined && limit !== undefined) {
      return `读取 ${base} L${offset}-${offset + limit - 1}`;
    }
    if (offset !== undefined) return `读取 ${base} L${offset}`;
    return `读取 ${base}`;
  }
  if (name === GREP_TOOL_NAME || name === "WebSearch") {
    const query =
      stringParam(params, "pattern") ||
      stringParam(params, "query") ||
      block.compactParams ||
      "";
    return query ? `搜索 ${query}` : "搜索";
  }
  if (name === GLOB_TOOL_NAME) {
    const pattern = stringParam(params, "pattern") || block.compactParams || "";
    return pattern ? `查找文件 ${pattern}` : "查找文件";
  }
  if (name === EDIT_TOOL_NAME || name === WRITE_TOOL_NAME) {
    const path = stringParam(params, "file_path");
    const base = path ? baseName(path) : block.compactParams || "文件";
    return `编辑 ${base}`;
  }
  if (name === BASH_TOOL_NAME) {
    const description = stringParam(params, "description").trim();
    const command = stringParam(params, "command").trim();
    const commandFirst = command.split("\n")[0]?.trim() ?? "";
    const compact = (block.compactParams || "").trim();
    const brief =
      description ||
      (compact && compact !== command && compact !== commandFirst
        ? compact
        : "");
    return brief ? `运行 ${brief}` : "运行";
  }
  if (kindOf(name) === "browser") {
    const url = stringParam(params, "url") || block.compactParams || "";
    return url ? `打开 ${url}` : "打开";
  }
  if (name === AGENT_TOOL_NAME) {
    return (
      block.compactParams || stringParam(params, "description") || "子任务"
    );
  }
  if (name === ASK_USER_QUESTION_TOOL_NAME) return "询问";
  if (block.compactParams) return `${name} ${block.compactParams}`;
  return name;
}

/** Read / edit / write rows open this file. Line ranges come from Read's offset. */
export function toolOpenTarget(block: ToolBlock): {
  path: string;
  startLine?: number;
  endLine?: number;
} | null {
  if (
    block.name !== READ_TOOL_NAME &&
    block.name !== EDIT_TOOL_NAME &&
    block.name !== WRITE_TOOL_NAME
  ) {
    return null;
  }
  const params = parseParams(block);
  const path = stringParam(params, "file_path");
  if (!path) return null;
  if (block.name !== READ_TOOL_NAME) return { path };
  const offset = typeof params.offset === "number" ? params.offset : undefined;
  const limit = typeof params.limit === "number" ? params.limit : undefined;
  return {
    path,
    startLine: offset,
    endLine: offset !== undefined && limit !== undefined ? offset + limit - 1 : undefined,
  };
}

export function toolPresentation(block: ToolBlock): {
  label: string;
  additions: number;
  deletions: number;
} {
  const label = toolLineLabel(block);
  if (
    block.error ||
    block.success === false ||
    (block.name !== EDIT_TOOL_NAME && block.name !== WRITE_TOOL_NAME)
  ) {
    return { label, additions: 0, deletions: 0 };
  }
  return { label, ...toolStats(block) };
}

export function toolHasDetail(block: ToolBlock): boolean {
  if (block.error || block.success === false) return false;
  const params = parseParams(block);
  const name = block.name;
  if (name === BASH_TOOL_NAME) {
    return Boolean(
      stringParam(params, "command") ||
        block.compactParams ||
        block.result ||
        block.shortResult,
    );
  }
  if (name === WRITE_TOOL_NAME) {
    return block.stage !== "streaming" && typeof params.content === "string";
  }
  if (name === EDIT_TOOL_NAME) {
    return (
      block.stage === "end" &&
      typeof params.old_string === "string" &&
      typeof params.new_string === "string"
    );
  }
  if (
    name === READ_TOOL_NAME ||
    name === GREP_TOOL_NAME ||
    name === GLOB_TOOL_NAME ||
    name === WEB_FETCH_TOOL_NAME ||
    name === "WebSearch" ||
    name === AGENT_TOOL_NAME
  ) {
    return false;
  }
  return Boolean((block.shortResult || block.result || "").trim());
}

export function reasoningLineLabel(
  block: ReasoningBlock,
  now = Date.now(),
): string {
  const inProgress =
    block.stage !== "end" && typeof block.startTime === "number";
  if (inProgress) {
    const seconds = Math.max(
      0,
      Math.floor((now - (block.startTime as number)) / 1000),
    );
    return `思考中 ${seconds}s`;
  }
  if (
    typeof block.startTime === "number" &&
    typeof block.endTime === "number"
  ) {
    const seconds = Math.max(
      1,
      Math.round(Math.abs(block.endTime - block.startTime) / 1000),
    );
    return `思考 ${seconds}s`;
  }
  return "思考";
}

export function bangLineLabel(block: BangBlock): string {
  const first = block.command.split("\n")[0]?.trim() ?? "";
  return first ? `运行 ${first}` : "运行";
}

export function isActivityLive(block: MessageBlock): boolean {
  if (block.type === "tool") {
    return (
      block.stage === "start" ||
      block.stage === "streaming" ||
      block.stage === "running"
    );
  }
  if (block.type === "reasoning") return block.stage !== "end";
  if (block.type === "bang") return block.stage === "running";
  return false;
}

export type ActivityCategory = "检索" | "编辑" | "执行";

export interface ActivityRef {
  messageIndex: number;
  blockIndex: number;
}

export type TurnSegment =
  | { type: "single"; ref: ActivityRef }
  | { type: "activity"; refs: ActivityRef[] };

interface TurnMessage {
  id?: string;
  blocks?: MessageBlock[];
}

function isWorkBlock(block: MessageBlock | undefined): boolean {
  return block?.type === "tool" || block?.type === "bang";
}

/** Live-step label. Searches, including WebSearch, stay with 检索. */
export function activityCategory(
  block: MessageBlock,
): ActivityCategory | null {
  if (block.type === "bang") return "执行";
  if (block.type !== "tool") return null;
  if (
    block.name === READ_TOOL_NAME ||
    block.name === GREP_TOOL_NAME ||
    block.name === GLOB_TOOL_NAME ||
    block.name === "WebSearch"
  ) {
    return "检索";
  }
  if (block.name === EDIT_TOOL_NAME || block.name === WRITE_TOOL_NAME) {
    return "编辑";
  }
  return "执行";
}

/**
 * Assistant text is the only split. The opening reasoning block of a turn
 * stays outside the groups. Later thoughts stay inside the run they sit in.
 */
export function segmentAssistantTurn(
  messages: TurnMessage[],
  omit?: { messageId: string; blockIndex: number },
): TurnSegment[] {
  const flat: ActivityRef[] = [];
  messages.forEach((message, messageIndex) => {
    (message.blocks ?? []).forEach((block, blockIndex) => {
      if (
        omit &&
        message.id === omit.messageId &&
        blockIndex === omit.blockIndex
      ) {
        return;
      }
      if (block.type === "file_history") return;
      if (block.type === "text" && !block.content?.trim()) return;
      flat.push({ messageIndex, blockIndex });
    });
  });

  const blockAt = (ref: ActivityRef) =>
    messages[ref.messageIndex]?.blocks?.[ref.blockIndex];

  const segments: TurnSegment[] = [];
  let run: ActivityRef[] = [];
  let peeledOpeningThought = false;
  let seenWork = false;

  const flush = () => {
    if (run.length === 0) return;
    const hasWork = run.some((ref) => isWorkBlock(blockAt(ref)));
    if (hasWork) segments.push({ type: "activity", refs: run });
    else for (const ref of run) segments.push({ type: "single", ref });
    run = [];
  };

  for (const ref of flat) {
    const block = blockAt(ref);
    if (!block) continue;
    if (
      !peeledOpeningThought &&
      !seenWork &&
      run.length === 0 &&
      block.type === "reasoning"
    ) {
      segments.push({ type: "single", ref });
      peeledOpeningThought = true;
      continue;
    }
    if (block.type === "text") {
      seenWork = true;
      flush();
      segments.push({ type: "single", ref });
      continue;
    }
    if (block.type === "tool" || block.type === "bang" || block.type === "reasoning") {
      if (block.type !== "reasoning") seenWork = true;
      run.push(ref);
      continue;
    }
    seenWork = true;
    flush();
    segments.push({ type: "single", ref });
  }
  flush();
  return segments;
}

export function segmentAssistantBlocks(
  blocks: MessageBlock[],
): AssistantSegment[] {
  return segmentAssistantTurn([{ blocks }]).map((segment) =>
    segment.type === "single"
      ? { type: "single" as const, index: segment.ref.blockIndex }
      : {
          type: "activity" as const,
          indexes: segment.refs.map((ref) => ref.blockIndex),
        },
  );
}

type ActivityBucket =
  | "edit"
  | "file"
  | "search"
  | "browser"
  | "agent"
  | "command"
  | "other";

const BUCKET_ORDER: ActivityBucket[] = [
  "edit",
  "file",
  "search",
  "browser",
  "agent",
  "command",
  "other",
];

function bucketOf(block: MessageBlock): ActivityBucket | null {
  if (block.type === "bang") return "command";
  if (block.type !== "tool") return null;
  if (block.name === AGENT_TOOL_NAME) return "agent";
  if (block.name === "WebSearch") return "search";
  const kind = kindOf(block.name);
  if (kind === "file") return "file";
  if (kind === "search") return "search";
  if (kind === "edit") return "edit";
  if (kind === "run") return "command";
  if (kind === "browser") return "browser";
  return "other";
}

function bucketPhrase(
  bucket: ActivityBucket,
  count: number,
  lead: boolean,
): string {
  if (bucket === "edit") {
    return lead ? `编辑 ${count} 个文件` : `编辑了 ${count} 个文件`;
  }
  if (bucket === "file") {
    return lead ? `检索 ${count} 个文件` : `查看了 ${count} 个文件`;
  }
  if (bucket === "search") {
    return lead ? `检索 ${count} 次搜索` : `${count} 次搜索`;
  }
  if (bucket === "browser") {
    return lead ? `浏览 ${count} 次` : `浏览了 ${count} 次`;
  }
  if (bucket === "agent") {
    return lead ? `子任务 ${count} 个` : `${count} 个子任务`;
  }
  if (bucket === "command") {
    return lead ? `执行 ${count} 条命令` : `运行了 ${count} 条命令`;
  }
  return lead ? `执行 ${count} 次操作` : `${count} 次操作`;
}

export function summarizeRefs(
  messages: TurnMessage[],
  refs: ActivityRef[],
): ActivitySummary {
  let additions = 0;
  let deletions = 0;
  const files = new Set<string>();
  const edits = new Set<string>();
  const counts: Record<ActivityBucket, number> = {
    edit: 0,
    file: 0,
    search: 0,
    browser: 0,
    agent: 0,
    command: 0,
    other: 0,
  };

  refs.forEach((ref, index) => {
    const block = messages[ref.messageIndex]?.blocks?.[ref.blockIndex];
    if (!block) return;
    const bucket = bucketOf(block);
    if (!bucket) return;
    if (bucket === "file" && block.type === "tool") {
      const path =
        stringParam(parseParams(block), "file_path") ||
        block.compactParams ||
        `file-${index}`;
      files.add(path);
      return;
    }
    if (bucket === "edit" && block.type === "tool") {
      const path =
        stringParam(parseParams(block), "file_path") ||
        block.compactParams ||
        `edit-${index}`;
      edits.add(path);
      const stats = toolStats(block);
      additions += stats.additions;
      deletions += stats.deletions;
      return;
    }
    counts[bucket] += 1;
  });
  counts.file = files.size;
  counts.edit = edits.size;

  const parts: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    const count = counts[bucket];
    if (count <= 0) continue;
    parts.push(bucketPhrase(bucket, count, parts.length === 0));
  }
  return {
    label: parts.join("，"),
    additions,
    deletions,
  };
}

export function currentStatusLabel(
  messages: Array<{
    role?: string;
    isMeta?: boolean;
    blocks?: MessageBlock[];
  }>,
): string | null {
  const turn: Array<{ blocks?: MessageBlock[] }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      if (message.isMeta) continue;
      break;
    }
    if (message.role === "assistant") turn.unshift(message);
  }
  for (let i = turn.length - 1; i >= 0; i--) {
    const blocks = turn[i].blocks ?? [];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j];
      // The reply is already streaming in the message body.
      if (block.type === "text" && block.stage === "streaming") return null;
      if (!isActivityLive(block)) continue;
      if (block.type === "reasoning") return "思考中…";
      const category = activityCategory(block);
      if (category) return `${category}中…`;
    }
  }
  return "正在处理…";
}

export function summarizeActivity(
  blocks: MessageBlock[],
  indexes: number[],
): ActivitySummary {
  return summarizeRefs(
    [{ blocks }],
    indexes.map((blockIndex) => ({ messageIndex: 0, blockIndex })),
  );
}
