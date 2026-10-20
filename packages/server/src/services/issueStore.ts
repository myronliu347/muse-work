import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import {
  finalizeLegacyClosedIndexMigration,
  loadClosedIssues,
  saveClosedIssues,
} from "./issueClosedStorage.js";

export type IssueAgentMode = "single" | "split";
export type IssuePriority = "p0" | "p1" | "p2";
/** 只做分类，不决定会话模式或 worktree。缺省 work。 */
export type IssueType =
  | "bug"
  | "feature"
  | "research"
  | "analysis"
  | "review"
  | "work";
export type IssueStatus =
  | "pending"
  | "planning"
  | "executing"
  | "review"
  | "awaiting_close"
  | "completed"
  | "cancelled";
export type ChecklistItemStatus = "pending" | "running" | "done";

export interface ChecklistItem {
  id: string;
  content: string;
  status: ChecklistItemStatus;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  priority: IssuePriority;
  type: IssueType;
  status: IssueStatus;
  /** single = 本会话规划并实现；split = 规划会话 + 执行会话。缺省按 split。 */
  agentMode: IssueAgentMode;
  workdir?: string;
  worktreeEnabled?: boolean;
  baseBranch?: string;
  planningSessionId?: string;
  executionSessionId?: string;
  items: ChecklistItem[];
  /** 完成时的结果结论，或取消时的原因。 */
  closeNote?: string;
  createdAt: number;
  updatedAt: number;
}

export type IssuesFile = {
  version: 1;
  issues: Issue[];
};

export interface IssueStore {
  create(input: {
    title: string;
    description?: string;
    priority?: IssuePriority;
    type?: IssueType;
  }): Issue;
  get(id: string): Issue | undefined;
  listActive(): Issue[];
  listClosed(): Issue[];
  listAll(): Issue[];
  update(
    id: string,
    patch: Partial<Pick<Issue, "title" | "description" | "priority" | "type">>,
  ): Issue | undefined;
  setPlanning(
    id: string,
    fields: {
      planningSessionId: string;
      workdir: string;
      worktreeEnabled: boolean;
      baseBranch?: string;
      agentMode?: IssueAgentMode;
    },
  ): Issue | undefined;
  /** 单会话声明事情做完，留在未完成列表里等用户关闭。 */
  markReady(id: string): Issue | undefined;
  /** 待关闭的 Issue 收到新消息后回到进行中。 */
  resume(id: string): Issue | undefined;
  setExecutionSessionId(id: string, executionSessionId: string): Issue | undefined;
  setItems(id: string, items: ChecklistItem[]): Issue | undefined;
  appendItems(
    id: string,
    items: Array<{ content: string }>,
  ): Issue | undefined;
  removePendingItem(id: string, itemId: string): Issue | undefined;
  acceptItem(id: string, itemId: string): Issue | undefined;
  patchItem(
    id: string,
    itemId: string,
    patch: Partial<Pick<ChecklistItem, "content" | "status">>,
  ): Issue | undefined;
  complete(id: string, note: string): Issue | undefined;
  cancel(id: string, note: string): Issue | undefined;
  maybeEnterReview(id: string): Issue | undefined;
  markExecuting(id: string): Issue | undefined;
  subscribe(
    fn: (e: {
      event: "created" | "review" | "completed" | "cancelled";
      issue: Issue;
    }) => void,
  ): () => void;
  /** True when this session id is some Issue's planning session. */
  hasPlanningSession(sessionId: string): boolean;
  getByPlanningSession(sessionId: string): Issue | undefined;
}

export interface CreateIssueStoreOptions {
  home?: string;
}

const PRIORITY_ORDER: Record<IssuePriority, number> = { p0: 0, p1: 1, p2: 2 };
const KNOWN_STATUSES = new Set<IssueStatus>([
  "pending",
  "planning",
  "executing",
  "review",
  "awaiting_close",
  "completed",
  "cancelled",
]);
const KNOWN_PRIORITIES = new Set<IssuePriority>(["p0", "p1", "p2"]);

function isKnownStatus(status: unknown): status is IssueStatus {
  return typeof status === "string" && KNOWN_STATUSES.has(status as IssueStatus);
}

function normalizePriority(priority: unknown): IssuePriority {
  return typeof priority === "string" &&
    KNOWN_PRIORITIES.has(priority as IssuePriority)
    ? (priority as IssuePriority)
    : "p1";
}

function getIssuesIndexPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "issues.json");
}

function defaultIssuesFile(): IssuesFile {
  return { version: 1, issues: [] };
}

function loadIssuesFile(filePath: string): IssuesFile {
  if (!fs.existsSync(filePath)) {
    return defaultIssuesFile();
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as IssuesFile;
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function saveIssuesFile(file: IssuesFile, filePath: string): void {
  writeAtomically(filePath, JSON.stringify(file, null, 2) + "\n");
}

function requireCloseNote(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("close note required");
  return trimmed;
}

function isTerminal(status: IssueStatus): boolean {
  return status === "completed" || status === "cancelled";
}

function cloneIssue(issue: Issue): Issue {
  return {
    ...issue,
    items: issue.items.map((item) => ({ ...item })),
  };
}

const ISSUE_TYPES = new Set<IssueType>([
  "bug",
  "feature",
  "research",
  "analysis",
  "review",
  "work",
]);

export function normalizeIssueType(value: unknown): IssueType {
  return typeof value === "string" && ISSUE_TYPES.has(value as IssueType)
    ? (value as IssueType)
    : "work";
}

export function allItemsDone(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === "done");
}

function normalizeAgentMode(value: unknown): IssueAgentMode {
  return value === "single" ? "single" : "split";
}

function hydrateIssue(record: Issue & { tags?: unknown }): Issue {
  const { tags: _tags, ...rest } = record;
  return {
    ...rest,
    title: record.title,
    description: record.description ?? "",
    priority: normalizePriority(record.priority),
    type: normalizeIssueType(record.type),
    items: record.items ?? [],
    agentMode: normalizeAgentMode(record.agentMode),
  };
}

export function createIssueStore(
  options: CreateIssueStoreOptions = {},
): IssueStore {
  const home = options.home ?? process.env.MUSE_HOME ?? os.homedir();
  const activeFile = loadIssuesFile(getIssuesIndexPath(home));
  const closedRecords = loadClosedIssues(home, hydrateIssue, isTerminal);
  const issues = new Map<string, Issue>();
  const closed = new Map<string, Issue>();
  const listeners = new Set<
    (e: {
      event: "created" | "review" | "completed" | "cancelled";
      issue: Issue;
    }) => void
  >();

  function emit(
    event: "created" | "review" | "completed" | "cancelled",
    issue: Issue,
  ): void {
    const payload = { event, issue: cloneIssue(issue) };
    for (const listener of listeners) {
      listener(payload);
    }
  }

  for (const issue of closedRecords) {
    closed.set(issue.id, issue);
  }
  for (const record of activeFile.issues) {
    if (!record?.id || !record.title) continue;
    const issue = hydrateIssue(record);
    if (isTerminal(issue.status)) {
      closed.set(issue.id, issue);
    } else {
      issues.set(issue.id, issue);
    }
  }

  function persistClosed(): void {
    saveClosedIssues(home, [...closed.values()]);
    finalizeLegacyClosedIndexMigration(home);
  }

  function persist(): void {
    saveIssuesFile(
      { version: 1, issues: [...issues.values()] },
      getIssuesIndexPath(home),
    );
    persistClosed();
  }

  const needsPersist =
    activeFile.issues.some((record) => isTerminal(record.status)) ||
    fs.existsSync(
      path.join(getMuseHomeDir(home), "db", "issues-closed.json"),
    );
  if (needsPersist) {
    persist();
  }

  function getMutable(id: string): Issue | undefined {
    return issues.get(id) ?? closed.get(id);
  }

  function archive(issue: Issue): void {
    issues.delete(issue.id);
    closed.set(issue.id, issue);
    persist();
  }

  return {
    create(input): Issue {
      const title = input.title.trim();
      if (!title) {
        throw new Error("title required");
      }
      const now = Date.now();
      const issue: Issue = {
        id: crypto.randomUUID(),
        title,
        description: input.description ?? "",
        priority: input.priority ?? "p1",
        type: normalizeIssueType(input.type),
        status: "pending",
        agentMode: "split",
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      issues.set(issue.id, issue);
      persist();
      emit("created", issue);
      return cloneIssue(issue);
    },

    get(id: string): Issue | undefined {
      const issue = getMutable(id);
      return issue ? cloneIssue(issue) : undefined;
    },

    listActive(): Issue[] {
      return [...issues.values()]
        .filter(
          (issue) => isKnownStatus(issue.status) && !isTerminal(issue.status),
        )
        .sort((a, b) => {
          const priorityDiff =
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          if (priorityDiff !== 0) {
            return priorityDiff;
          }
          return b.updatedAt - a.updatedAt;
        })
        .map(cloneIssue);
    },

    listClosed(): Issue[] {
      return [...closed.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(cloneIssue);
    },

    listAll(): Issue[] {
      return [...issues.values(), ...closed.values()].map(cloneIssue);
    },

    update(id, patch): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) {
        return undefined;
      }
      if (patch.title !== undefined) {
        const title = patch.title.trim();
        if (!title) {
          throw new Error("title required");
        }
        issue.title = title;
      }
      if (patch.description !== undefined) {
        issue.description = patch.description;
      }
      if (patch.priority !== undefined) {
        issue.priority = patch.priority;
      }
      if (patch.type !== undefined) {
        issue.type = normalizeIssueType(patch.type);
      }
      issue.updatedAt = Date.now();
      persist();
      return cloneIssue(issue);
    },

    setPlanning(id, fields): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || isTerminal(issue.status)) {
        return undefined;
      }
      issue.planningSessionId = fields.planningSessionId;
      issue.workdir = fields.workdir;
      issue.worktreeEnabled = fields.worktreeEnabled;
      if (fields.baseBranch !== undefined) {
        issue.baseBranch = fields.baseBranch;
      }
      if (fields.agentMode !== undefined) {
        issue.agentMode = fields.agentMode;
      }
      issue.status = "planning";
      issue.updatedAt = Date.now();
      persist();
      return cloneIssue(issue);
    },

    setExecutionSessionId(id, executionSessionId): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) {
        return undefined;
      }
      issue.executionSessionId = executionSessionId;
      issue.updatedAt = Date.now();
      persist();
      return cloneIssue(issue);
    },

    setItems(id, items): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) {
        return undefined;
      }
      issue.items = items.map((item) => ({ ...item }));
      issue.updatedAt = Date.now();
      persist();
      return this.maybeEnterReview(id);
    },

    appendItems(id, items): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || isTerminal(issue.status)) {
        return undefined;
      }
      for (const raw of items) {
        const content = raw.content.trim();
        if (!content) continue;
        issue.items.push({
          id: crypto.randomUUID(),
          content,
          status: "pending",
        });
      }
      issue.updatedAt = Date.now();
      persist();
      return this.maybeEnterReview(id);
    },

    removePendingItem(id, itemId): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || isTerminal(issue.status)) {
        return undefined;
      }
      const item = issue.items.find((entry) => entry.id === itemId);
      if (!item) {
        return undefined;
      }
      if (item.status === "done") {
        throw Object.assign(new Error("cannot remove done items"), {
          statusCode: 409,
        });
      }
      issue.items = issue.items.filter((entry) => entry.id !== itemId);
      issue.updatedAt = Date.now();
      persist();
      return this.maybeEnterReview(id);
    },

    acceptItem(id, itemId): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || isTerminal(issue.status)) {
        return undefined;
      }
      const item = issue.items.find((entry) => entry.id === itemId);
      if (!item) {
        return undefined;
      }
      if (item.status === "running") {
        throw Object.assign(new Error("cannot accept running item"), {
          statusCode: 409,
        });
      }
      if (item.status !== "done") {
        item.status = "done";
        issue.updatedAt = Date.now();
        persist();
      }
      return this.maybeEnterReview(id);
    },

    patchItem(id, itemId, patch): Issue | undefined {
      const issue = getMutable(id);
      if (!issue) {
        return undefined;
      }
      const item = issue.items.find((entry) => entry.id === itemId);
      if (!item) {
        return undefined;
      }
      if (patch.content !== undefined) {
        item.content = patch.content;
      }
      if (patch.status !== undefined) {
        item.status = patch.status;
      }
      issue.updatedAt = Date.now();
      persist();
      return this.maybeEnterReview(id);
    },

    markReady(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || isTerminal(issue.status)) return undefined;
      if (issue.agentMode !== "single") {
        throw new Error("only single agent issues can be marked ready");
      }
      if (issue.status !== "awaiting_close") {
        issue.status = "awaiting_close";
        issue.updatedAt = Date.now();
        persist();
      }
      return cloneIssue(issue);
    },

    resume(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) return undefined;
      if (issue.status !== "awaiting_close") return cloneIssue(issue);
      issue.status = "planning";
      issue.updatedAt = Date.now();
      persist();
      return cloneIssue(issue);
    },

    complete(id, note): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || issue.status === "cancelled") {
        return undefined;
      }
      issue.closeNote = requireCloseNote(note);
      issue.status = "completed";
      issue.updatedAt = Date.now();
      archive(issue);
      emit("completed", issue);
      return cloneIssue(issue);
    },

    cancel(id, note): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || issue.status === "completed") {
        return undefined;
      }
      issue.closeNote = requireCloseNote(note);
      issue.status = "cancelled";
      issue.updatedAt = Date.now();
      archive(issue);
      emit("cancelled", issue);
      return cloneIssue(issue);
    },

    maybeEnterReview(id): Issue | undefined {
      const issue = getMutable(id);
      if (!issue) {
        return undefined;
      }
      if (issue.agentMode === "single") {
        return cloneIssue(issue);
      }
      if (isTerminal(issue.status) || issue.status === "review") {
        return cloneIssue(issue);
      }
      if (
        issue.status === "executing" &&
        issue.items.length > 0 &&
        allItemsDone(issue.items)
      ) {
        issue.status = "review";
        issue.updatedAt = Date.now();
        persist();
        emit("review", issue);
      }
      return cloneIssue(issue);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    markExecuting(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) {
        return undefined;
      }
      if (issue.agentMode === "single") {
        return cloneIssue(issue);
      }
      if (issue.status === "review" || issue.status === "executing") {
        return cloneIssue(issue);
      }
      if (issue.status === "planning") {
        issue.status = "executing";
        issue.updatedAt = Date.now();
        persist();
        return cloneIssue(issue);
      }
      return undefined;
    },

    hasPlanningSession(sessionId): boolean {
      return this.getByPlanningSession(sessionId) !== undefined;
    },

    getByPlanningSession(sessionId): Issue | undefined {
      for (const issue of [...issues.values(), ...closed.values()]) {
        if (issue.planningSessionId === sessionId) return cloneIssue(issue);
      }
      return undefined;
    },
  };
}
