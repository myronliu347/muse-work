import path from "node:path";

/** Planning sessions may Edit/Write these as documents, not source. */
const PLANNING_DOC_EXTS = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".rst",
  ".adoc",
]);

const PLANNING_WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export const PLANNING_CODE_WRITE_DENIED =
  "规划会话不能修改产品实现。可读代码、写计划/分析文档、调用分析类工具；改实现请 dispatch 到执行会话。";

const SOURCE_FILE_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|vue|go|rs|py|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift)\b/i;

export function looksLikeSourceMutation(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (/\b(sed|perl|ruby|python3?)\b[^\n]*\s-i\b/i.test(cmd)) return true;
  if (/\bgit\s+apply\b/i.test(cmd)) return true;
  if (new RegExp(`(>|>>|\\btee\\b)[^\\n]*${SOURCE_FILE_RE.source}`, "i").test(cmd)) {
    return true;
  }
  if (new RegExp(`\\b(rm|mv|cp)\\b[^\\n]*${SOURCE_FILE_RE.source}`, "i").test(cmd)) {
    return true;
  }
  return false;
}

function extractBashCommand(toolInput?: Record<string, unknown>): string | undefined {
  if (!toolInput) return undefined;
  for (const key of ["command", "cmd", "bash"]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** Deny Edit/Write on implementation files, and Bash that mutates them. Null = allow. */
export function planningCodeWriteDecision(
  toolName: string,
  toolInput?: Record<string, unknown>,
): { behavior: "deny"; message: string } | null {
  if (toolName === "Bash" || toolName === "bash") {
    const command = extractBashCommand(toolInput);
    if (command && looksLikeSourceMutation(command)) {
      return { behavior: "deny", message: PLANNING_CODE_WRITE_DENIED };
    }
    return null;
  }
  if (!PLANNING_WRITE_TOOLS.has(toolName)) return null;
  const filePath = extractToolPath(toolInput);
  if (filePath && isPlanningDocPath(filePath)) return null;
  return { behavior: "deny", message: PLANNING_CODE_WRITE_DENIED };
}

export function isPlanningDocPath(filePath: string): boolean {
  return PLANNING_DOC_EXTS.has(path.extname(filePath).toLowerCase());
}

function extractToolPath(
  toolInput?: Record<string, unknown>,
): string | undefined {
  if (!toolInput) return undefined;
  for (const key of [
    "path",
    "file_path",
    "filePath",
    "notebook_path",
    "notebookPath",
  ]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function buildIssuePlanningExtra(issue: {
  id: string;
  title: string;
  description: string;
}): string {
  const description = issue.description.trim() || "（无）";
  return [
    "当前会话是 Issue 的规划会话。",
    `Issue ID：${issue.id}`,
    `标题：${issue.title}`,
    `描述：${description}`,
    "",
    "你的职责：",
    "1. 与用户确认需求与方案；可读代码做分析；可写计划/分析文档（.md/.txt 等）；可调用分析类子代理。",
    "2. 不要修改产品实现（.ts/.js/.vue 等）。改实现必须维护清单后 dispatch 到执行会话。",
    "3. 不要用 Bash 改写实现文件来绕过。",
    "4. 清单与调度走 issue-management skill（issue.mjs）。",
    "5. Issue 进入执行中后你必须值守：每轮是 dispatch → 等执行回报 → 对照执行过程复核 → 达标则 items --done 再 dispatch 下一项，未达标则再派同一项。执行回合结束不会自动标 done。清单未全部完成时不要停下来等用户。",
    "6. 执行中断或失败时该项仍为 pending：根据执行过程判断卡在哪，只能对同一 itemId 再 dispatch 继续，禁止跳到下一项，禁止 --done。",
    "7. 未 --done 时系统会拒绝派下一项。不要把回报里的「本回合结束」当成达标。全部完成后进入待审核，停止自动 dispatch，向用户汇报。",
  ].join("\n");
}
