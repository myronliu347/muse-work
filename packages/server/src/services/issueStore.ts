import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

export type IssuePriority = "p0" | "p1" | "p2";
export type IssueStatus =
  | "pending"
  | "planning"
  | "executing"
  | "review"
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
  tags: string[];
  status: IssueStatus;
  workdir?: string;
  worktreeEnabled?: boolean;
  baseBranch?: string;
  planningSessionId?: string;
  executionSessionId?: string;
  items: ChecklistItem[];
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
    tags?: string[];
  }): Issue;
  get(id: string): Issue | undefined;
  listActive(): Issue[];
  listAll(): Issue[];
  update(
    id: string,
    patch: Partial<Pick<Issue, "title" | "description" | "priority" | "tags">>,
  ): Issue | undefined;
  setPlanning(
    id: string,
    fields: {
      planningSessionId: string;
      workdir: string;
      worktreeEnabled: boolean;
      baseBranch?: string;
    },
  ): Issue | undefined;
  setExecutionSessionId(id: string, executionSessionId: string): Issue | undefined;
  setItems(id: string, items: ChecklistItem[]): Issue | undefined;
  patchItem(
    id: string,
    itemId: string,
    patch: Partial<Pick<ChecklistItem, "content" | "status">>,
  ): Issue | undefined;
  complete(id: string): Issue | undefined;
  cancel(id: string): Issue | undefined;
  maybeEnterReview(id: string): Issue | undefined;
  markExecuting(id: string): Issue | undefined;
  /** True when this session id is some Issue's planning session. */
  hasPlanningSession(sessionId: string): boolean;
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

function getIssueDetailPath(home: string, id: string): string {
  return path.join(getMuseHomeDir(home), "db", "issues", id, "issue.json");
}

function defaultIssuesFile(): IssuesFile {
  return { version: 1, issues: [] };
}

function loadIssuesFile(home: string): IssuesFile {
  const configPath = getIssuesIndexPath(home);
  if (!fs.existsSync(configPath)) {
    return defaultIssuesFile();
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as IssuesFile;
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function saveIssueDetail(issue: Issue, home: string): void {
  writeAtomically(
    getIssueDetailPath(home, issue.id),
    JSON.stringify(issue, null, 2) + "\n",
  );
}

function saveIssuesFile(file: IssuesFile, home: string): void {
  writeAtomically(
    getIssuesIndexPath(home),
    JSON.stringify(file, null, 2) + "\n",
  );
  for (const issue of file.issues) {
    saveIssueDetail(issue, home);
  }
}

function isTerminal(status: IssueStatus): boolean {
  return status === "completed" || status === "cancelled";
}

function cloneIssue(issue: Issue): Issue {
  return {
    ...issue,
    tags: [...issue.tags],
    items: issue.items.map((item) => ({ ...item })),
  };
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = String(tag).trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export function allItemsDone(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === "done");
}

export function createIssueStore(
  options: CreateIssueStoreOptions = {},
): IssueStore {
  const home = options.home ?? process.env.MUSE_HOME ?? os.homedir();
  const file = loadIssuesFile(home);
  const issues = new Map<string, Issue>();

  for (const record of file.issues) {
    if (!record?.id || !record.title) continue;
    issues.set(record.id, {
      ...record,
      title: record.title,
      description: record.description ?? "",
      priority: normalizePriority(record.priority),
      tags: normalizeTags(record.tags),
      items: record.items ?? [],
    });
  }

  function persist(): void {
    saveIssuesFile(
      {
        version: 1,
        issues: [...issues.values()],
      },
      home,
    );
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
        tags: normalizeTags(input.tags),
        status: "pending",
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      issues.set(issue.id, issue);
      persist();
      return cloneIssue(issue);
    },

    get(id: string): Issue | undefined {
      const issue = issues.get(id);
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

    listAll(): Issue[] {
      return [...issues.values()].map(cloneIssue);
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
      if (patch.tags !== undefined) {
        issue.tags = normalizeTags(patch.tags);
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

    patchItem(id, itemId, patch): Issue | undefined {
      const issue = issues.get(id);
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

    complete(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || issue.status === "cancelled") {
        return undefined;
      }
      issue.status = "completed";
      issue.updatedAt = Date.now();
      persist();
      return cloneIssue(issue);
    },

    cancel(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue || issue.status === "completed") {
        return undefined;
      }
      issue.status = "cancelled";
      issue.updatedAt = Date.now();
      persist();
      return cloneIssue(issue);
    },

    maybeEnterReview(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) {
        return undefined;
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
      }
      return cloneIssue(issue);
    },

    markExecuting(id): Issue | undefined {
      const issue = issues.get(id);
      if (!issue) {
        return undefined;
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
      for (const issue of issues.values()) {
        if (issue.planningSessionId === sessionId) return true;
      }
      return false;
    },
  };
}
