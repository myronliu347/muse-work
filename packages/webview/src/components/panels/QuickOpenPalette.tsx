import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon } from "./FileIcon";
import { IssueTypeIcon } from "../issue/IssueTypeIcon";
import { MiddleEllipsisText } from "../shared/MiddleEllipsisText";

export type QuickOpenHit = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory?: boolean;
};

export type QuickOpenIssue = {
  id: string;
  title: string;
  type?: string;
};

export type QuickOpenPaletteProps = {
  open: boolean;
  /** Default search scope (current issue's workdir when there is one). */
  workdir: string | undefined;
  /** Other workdirs the user can switch the search scope to. */
  workdirs?: string[];
  vscode: { postMessage: (msg: unknown) => void };
  onClose: () => void;
  onOpenFile: (absPath: string) => void;
  /** 和文件一起搜。选中后切到这条事项。 */
  issues?: QuickOpenIssue[];
  onSelectIssue?: (issueId: string) => void;
  /** Prefill when opened from a multi-hit markdown link. */
  initialQuery?: string;
};

type QuickOpenRow =
  | { kind: "issue"; issue: QuickOpenIssue }
  | { kind: "file"; hit: QuickOpenHit };

let quickOpenSeq = 0;

function matchIssues(issues: QuickOpenIssue[], query: string): QuickOpenIssue[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return issues
    .filter(
      (issue) =>
        issue.title.toLowerCase().includes(q) ||
        issue.id.toLowerCase().includes(q),
    )
    .slice(0, 20);
}

/** Keep long absolute workdirs readable inside the scope picker. */
function shortWorkdir(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 2) return dir;
  return `…/${parts.slice(-2).join("/")}`;
}

export const QuickOpenPalette: React.FC<QuickOpenPaletteProps> = ({
  open,
  workdir,
  workdirs = [],
  vscode,
  onClose,
  onOpenFile,
  issues = [],
  onSelectIssue,
  initialQuery = "",
}) => {
  const [query, setQuery] = useState("");
  const [scopeWorkdir, setScopeWorkdir] = useState<string | undefined>(workdir);
  const [hits, setHits] = useState<QuickOpenHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scopeOptions = useMemo(() => {
    const out: string[] = [];
    for (const dir of [workdir, ...workdirs]) {
      if (dir && !out.includes(dir)) out.push(dir);
    }
    return out;
  }, [workdir, workdirs]);
  const issueHits = useMemo(() => matchIssues(issues, query), [issues, query]);
  const rows: QuickOpenRow[] = [
    ...issueHits.map((issue) => ({ kind: "issue" as const, issue })),
    ...hits.map((hit) => ({ kind: "file" as const, hit })),
  ];

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setSelectedIndex(0);
      return;
    }
    setQuery(initialQuery);
    setScopeWorkdir(workdir);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, initialQuery, workdir]);

  useEffect(() => {
    if (!open) return;
    const onMsg = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.command !== "fileSuggestionsResponse") return;
      if (data.requestId !== requestIdRef.current) return;
      const suggestions = Array.isArray(data.suggestions)
        ? (data.suggestions as QuickOpenHit[])
        : [];
      setHits(suggestions.filter((s) => !s.isDirectory));
      setSelectedIndex(0);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    setSelectedIndex(0);
    if (!q || !scopeWorkdir) {
      setHits([]);
      requestIdRef.current = undefined;
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const requestId = `qo-${++quickOpenSeq}`;
      requestIdRef.current = requestId;
      vscode.postMessage({
        command: "requestFileSuggestions",
        requestId,
        filterText: q,
        dir: "",
        workdir: scopeWorkdir,
        source: "quickOpen",
      });
    }, 150);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, query, scopeWorkdir, vscode]);

  if (!open) return null;

  const openSelected = () => {
    const row = rows[selectedIndex];
    if (!row) return;
    if (row.kind === "issue") onSelectIssue?.(row.issue.id);
    else onOpenFile(row.hit.path);
    onClose();
  };

  const trimmed = query.trim();
  const empty = !trimmed
    ? "输入文件名或事项开始搜索"
    : !scopeWorkdir && issueHits.length === 0
      ? "选择工作目录后打开文件"
      : rows.length === 0
        ? "无匹配"
        : null;

  return (
    <div
      className="quick-open-backdrop"
      data-testid="quick-open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-label="快速打开"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) =>
              rows.length ? Math.min(i + 1, rows.length - 1) : 0,
            );
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            openSelected();
          }
        }}
      >
        <div className="quick-open-search">
          <input
            ref={inputRef}
            className="quick-open-input"
            data-testid="quick-open-input"
            placeholder="搜索文件或事项…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {scopeOptions.length > 1 ? (
            <div className="quick-open-scope">
              <i
                className="codicon codicon-folder quick-open-scope-icon"
                aria-hidden
              />
              <select
                className="quick-open-scope-select"
                data-testid="quick-open-scope"
                aria-label="搜索范围"
                title={scopeWorkdir ?? undefined}
                value={scopeWorkdir ?? ""}
                onChange={(event) => {
                  setScopeWorkdir(event.target.value || undefined);
                }}
              >
                {!scopeWorkdir ? <option value="">选择工作目录</option> : null}
                {scopeOptions.map((dir) => (
                  <option key={dir} value={dir} title={dir}>
                    {shortWorkdir(dir)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="quick-open-list">
          {empty ? (
            <div className="quick-open-empty">{empty}</div>
          ) : (
            rows.map((row, i) =>
              row.kind === "issue" ? (
                <button
                  key={`issue:${row.issue.id}`}
                  type="button"
                  className={`quick-open-item${
                    i === selectedIndex ? " quick-open-item--active" : ""
                  }`}
                  data-testid={`quick-open-issue-${row.issue.id}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => {
                    onSelectIssue?.(row.issue.id);
                    onClose();
                  }}
                >
                  <IssueTypeIcon type={row.issue.type} />
                  <span className="quick-open-item-path">{row.issue.title}</span>
                </button>
              ) : (
                <button
                  key={row.hit.path}
                  type="button"
                  className={`quick-open-item${
                    i === selectedIndex ? " quick-open-item--active" : ""
                  }`}
                  data-testid={`quick-open-item-${row.hit.relativePath}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => {
                    onOpenFile(row.hit.path);
                    onClose();
                  }}
                >
                  <FileIcon name={row.hit.name} className="file-tree-icon" />
                  <MiddleEllipsisText
                    text={row.hit.relativePath}
                    className="quick-open-item-path"
                  />
                </button>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickOpenPalette;
