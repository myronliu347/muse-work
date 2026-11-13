import type { DesktopPanelKind } from "../types";
import type { DockToolInstance } from "../stores/panelGroupStore";

let toolSeq = 0;

export function createDockToolId(kind: "terminal" | "preview"): string {
  toolSeq += 1;
  return `${kind}-${Date.now().toString(36)}-${toolSeq}`;
}

/** Host PTY id for one bot terminal tab. Unique per tab, not per directory. */
export function botToolTermId(id: string): string {
  return `bot-term-${id}`;
}

export function appendDockTool(
  tools: readonly DockToolInstance[],
  tool: DockToolInstance,
): DockToolInstance[] {
  return [...tools, tool];
}

export function removeDockTool(
  tools: readonly DockToolInstance[],
  id: string,
): DockToolInstance[] {
  return tools.filter((tool) => tool.id !== id);
}

/** Prefer another tab of the same kind, then any remaining tab. */
export function nextDockToolId(
  tools: readonly DockToolInstance[],
  closedId: string,
  activeId: string | null,
): string | null {
  const closed = tools.find((tool) => tool.id === closedId);
  const remaining = tools.filter((tool) => tool.id !== closedId);
  if (!closed) {
    if (activeId && activeId !== closedId && remaining.some((tool) => tool.id === activeId)) {
      return activeId;
    }
    return remaining.at(-1)?.id ?? null;
  }
  if (activeId && activeId !== closedId && remaining.some((tool) => tool.id === activeId)) {
    return activeId;
  }
  const sameKind = remaining.filter((tool) => tool.kind === closed.kind);
  return (sameKind.at(-1) ?? remaining.at(-1))?.id ?? null;
}

export function patchDockTool(
  tools: readonly DockToolInstance[],
  id: string,
  patch: Partial<Omit<DockToolInstance, "id" | "kind">>,
): DockToolInstance[] {
  return tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool));
}

/**
 * 重启终端：把这一格的终端标签换成同位置的新实例（新 id ⇒ 新 PTY），
 * 直接落到 `workdir`（当前事项 / 助手的目录）。标签在标签栏里的位置不变，
 * 旧 PTY 由调用方先 kill。
 */
export function rebuildTerminalTool(
  tools: readonly DockToolInstance[],
  id: string,
  workdir: string,
  nextId: string,
): DockToolInstance[] {
  return tools.map((tool) =>
    tool.id === id ? { id: nextId, kind: "terminal", workdir } : tool,
  );
}

/** The focused browser, or the most recently opened one. */
export function activePreviewTool(
  tools: readonly DockToolInstance[],
  activeId: string | null,
): DockToolInstance | undefined {
  const active = tools.find((tool) => tool.id === activeId && tool.kind === "preview");
  if (active) return active;
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    if (tools[i].kind === "preview") return tools[i];
  }
  return undefined;
}

function directoryName(workdir: string | undefined): string {
  if (!workdir) return "终端";
  const trimmed = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  return trimmed.split("/").pop() || "终端";
}

function previewName(url: string | null | undefined): string {
  if (!url) return "浏览器";
  try {
    return new URL(url).host || "浏览器";
  } catch {
    return "浏览器";
  }
}

/** Guest document.title, collapsed and capped for a tab label. */
export function normalizePageTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}

function previewLabel(tool: Pick<DockToolInstance, "previewUrl" | "pageTitle">): string {
  const title = tool.pageTitle?.trim();
  if (title) return title;
  return previewName(tool.previewUrl);
}

export function dockToolLabel(
  tool: DockToolInstance,
  tools: readonly DockToolInstance[],
): string {
  const name = tool.kind === "terminal" ? directoryName(tool.workdir) : previewLabel(tool);
  const same = tools.filter((item) => {
    const itemName = item.kind === "terminal" ? directoryName(item.workdir) : previewLabel(item);
    return item.kind === tool.kind && itemName === name;
  });
  if (same.length <= 1) return name;
  const index = same.findIndex((item) => item.id === tool.id);
  return index <= 0 ? name : `${name} ${index + 1}`;
}

export function dockToolTitle(tool: DockToolInstance): string {
  if (tool.kind === "terminal") return tool.workdir || "终端";
  return tool.pageTitle?.trim() || tool.previewUrl || "浏览器";
}

/**
 * On an issue-bound bot dock, file and diff follow that issue.
 * Terminal and browser come only from bot-level tools.
 */
export function botIssueChromeChecked(
  issueChecked: readonly DesktopPanelKind[],
  tools: readonly DockToolInstance[],
): DesktopPanelKind[] {
  const scoped = issueChecked.filter((kind) => kind === "file" || kind === "diff");
  const extra: DesktopPanelKind[] = [];
  if (tools.some((tool) => tool.kind === "terminal")) extra.push("terminal");
  if (tools.some((tool) => tool.kind === "preview")) extra.push("preview");
  return [...scoped, ...extra];
}

/**
 * Chrome kinds the bot dock can show. An issue only contributes 文件 and 变更.
 * 终端 and 浏览器 are bot tools, so they stay selectable when no issue is current.
 */
export function botDockChromeChecked(
  issueBound: boolean,
  checked: readonly DesktopPanelKind[],
  tools: readonly DockToolInstance[],
): DesktopPanelKind[] {
  const kinds = issueBound
    ? botIssueChromeChecked(checked, tools)
    : [...checked];
  if (tools.some((tool) => tool.kind === "terminal") && !kinds.includes("terminal")) {
    kinds.push("terminal");
  }
  if (tools.some((tool) => tool.kind === "preview") && !kinds.includes("preview")) {
    kinds.push("preview");
  }
  return kinds;
}
