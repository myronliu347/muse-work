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
  "规划会话不能修改源码。请把改代码的工作 dispatch 到执行会话。缺陷分析、读代码、写文档（.md/.txt 等）仍可用。";

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

/** Deny Edit/Write/NotebookEdit on non-doc paths. Null = not a planning write tool, or a doc path. */
export function planningCodeWriteDecision(
  toolName: string,
  toolInput?: Record<string, unknown>,
): { behavior: "deny"; message: string } | null {
  if (!PLANNING_WRITE_TOOLS.has(toolName)) return null;
  const filePath = extractToolPath(toolInput);
  if (filePath && isPlanningDocPath(filePath)) return null;
  return { behavior: "deny", message: PLANNING_CODE_WRITE_DENIED };
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
    "1. 与用户确认需求与方案；可读代码做缺陷分析；可写文档（.md/.txt 等）。",
    "2. 禁止 Edit/Write 修改源码（.ts/.js/.vue 等）。改代码必须维护清单后 dispatch 到执行会话。",
    "3. 不要用 Bash 改写源码文件来绕过上述限制。",
    "4. 清单与调度走 issue-management skill（issue.mjs）。",
    "5. Issue 进入执行中后你必须值守：每轮是 dispatch → 等执行回报 → 根据执行过程复核 → 再 dispatch。清单未全部完成时不要停下来等用户。",
    "6. 执行中断或失败时该项回到 pending：根据执行过程判断卡在哪，只能对同一 itemId 再 dispatch 继续，禁止跳到下一项。",
    "7. 根据执行过程判断达标才 dispatch 下一个 pending，不要只看「已完成」。全部完成后进入待审核，停止自动 dispatch，向用户汇报。",
  ].join("\n");
}
