import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Progress, Switch } from "@radix-ui/themes";
import {
  MuseApiClient,
  type MemoryDreamProgress,
  type MemoryDreamReport,
  type MemoryDreamRunView,
  type MemoryDreamState,
  type MemoryFileMeta,
} from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { MuseModelSelect } from "../shared/MuseModelSelect";
import "../../styles/MemoryDreamSettings.css";

function formatWhen(at: number | undefined): string {
  if (!at) return "还没跑过";
  return new Date(at).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function phaseText(progress: MemoryDreamProgress | undefined): string {
  if (!progress) return "准备中…";
  switch (progress.phase) {
    case "copy":
      return "复制记忆副本";
    case "export":
      return "导出会话记录";
    case "analyze":
      return progress.total
        ? `分析会话 ${progress.index ?? 0}/${progress.total}`
        : "分析会话";
    case "organize":
      return "合并重复、整理索引";
    case "repair":
      return progress.total
        ? `修复校验问题 ${progress.index}/${Math.max(1, progress.total - 1)}`
        : "修复校验问题";
    case "lint":
      return "校验草稿";
    case "done":
      return "完成";
    default:
      return "整理中…";
  }
}

function statusBadge(run: MemoryDreamRunView) {
  if (run.status === "running") return { color: "blue" as const, label: "整理中" };
  if (run.status === "skipped") return { color: "gray" as const, label: "已跳过" };
  if (run.status === "failed") return { color: "red" as const, label: "失败" };
  if (run.adoptedAt) return { color: "green" as const, label: "已替换" };
  if (run.discardedAt) return { color: "gray" as const, label: "已丢弃" };
  return { color: "amber" as const, label: "待确认" };
}

const TYPE_LABEL: Record<string, string> = {
  user: "用户",
  feedback: "规则",
  project: "项目",
  reference: "参考",
};

function MetaRow({ meta }: { meta: MemoryFileMeta }) {
  return (
    <div className="md-file">
      <Badge size="1" variant="soft" color="gray" className="md-file-type">
        {TYPE_LABEL[meta.type] ?? (meta.type || "其他")}
      </Badge>
      <div className="md-file-body">
        <div className="md-file-name">
          {meta.name || meta.file}
          <span className="md-file-path">{meta.file}</span>
        </div>
        {meta.description ? (
          <div className="md-file-desc">{meta.description}</div>
        ) : null}
      </div>
      <span className="md-file-bytes">{formatBytes(meta.bytes)}</span>
    </div>
  );
}

function ChangedRow({
  meta,
}: {
  meta: MemoryFileMeta & { beforeBytes: number };
}) {
  const delta = meta.bytes - meta.beforeBytes;
  return (
    <div className="md-file">
      <Badge size="1" variant="soft" color="gray" className="md-file-type">
        {TYPE_LABEL[meta.type] ?? (meta.type || "其他")}
      </Badge>
      <div className="md-file-body">
        <div className="md-file-name">
          {meta.name || meta.file}
          <span className="md-file-path">{meta.file}</span>
        </div>
        {meta.description ? (
          <div className="md-file-desc">{meta.description}</div>
        ) : null}
      </div>
      <span className="md-file-bytes">
        {formatBytes(meta.beforeBytes)} → {formatBytes(meta.bytes)}
        <em className={delta >= 0 ? "is-up" : "is-down"}>
          {delta >= 0 ? "+" : ""}
          {formatBytes(Math.abs(delta))}
        </em>
      </span>
    </div>
  );
}

function FileGroup({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone: "add" | "change" | "remove";
  count: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (count === 0) return null;
  return (
    <div className="md-group">
      <div className="md-group-head">
        <span className={`md-group-dot is-${tone}`} />
        <span className="md-group-title">{title}</span>
        <span className="md-group-count">{count}</span>
        {count > 6 ? (
          <button
            type="button"
            className="md-link-btn"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : `展开全部 ${count}`}
          </button>
        ) : null}
      </div>
      <div className="md-group-body">
        {expanded ? children : React.Children.toArray(children).slice(0, 6)}
      </div>
    </div>
  );
}

function DraftReview({
  data,
  open,
  onToggleReport,
  reportOpen,
}: {
  data: MemoryDreamReport;
  open: boolean;
  onToggleReport: () => void;
  reportOpen: boolean;
}) {
  const reportRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!reportOpen) return;
    reportRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reportOpen]);

  return (
    <div className="md-review">
      <div className="md-review-summary">
        <span className="md-chip is-add">新增 {data.counts.added}</span>
        <span className="md-chip is-change">修改 {data.counts.changed}</span>
        <span className="md-chip is-remove">移除 {data.counts.removed}</span>
        {data.counts.conflicts > 0 ? (
          <span className="md-chip is-conflict">
            冲突 {data.counts.conflicts}
          </span>
        ) : null}
        {typeof data.durationMs === "number" ? (
          <span className="md-review-duration">
            耗时 {formatDuration(data.durationMs)}
          </span>
        ) : null}
        <button
          type="button"
          className="md-link-btn md-review-report-toggle"
          onClick={onToggleReport}
        >
          {reportOpen ? "收起详细报告" : "查看详细报告"}
        </button>
      </div>

      {reportOpen ? (
        <pre ref={reportRef} className="md-report-text">
          {data.report || "（没有报告）"}
        </pre>
      ) : null}

      {data.draftLint && !data.draftLint.ok ? (
        <p className="md-run-lint">
          草稿仍有 {data.draftLint.orphans} 个文件未进索引、
          {data.draftLint.overCap} 个超过 4 KB
          {data.liveLint
            ? `（现有记忆 ${data.liveLint.orphans} / ${data.liveLint.overCap}）`
            : ""}
          。校验未过不等于不能用；替换前会备份，可回滚。
        </p>
      ) : null}

      {open ? (
        <>
          <FileGroup title="新增记忆" tone="add" count={data.counts.added}>
            {data.added.map((meta) => (
              <MetaRow key={meta.file} meta={meta} />
            ))}
          </FileGroup>
          <FileGroup title="修改记忆" tone="change" count={data.counts.changed}>
            {data.changed.map((meta) => (
              <ChangedRow key={meta.file} meta={meta} />
            ))}
          </FileGroup>
          <FileGroup title="移除记忆" tone="remove" count={data.counts.removed}>
            {data.removed.map((meta) => (
              <MetaRow key={meta.file} meta={meta} />
            ))}
          </FileGroup>
          {data.counts.added + data.counts.changed + data.counts.removed ===
          0 ? (
            <p className="md-empty">这次草稿和当前记忆没有文件级差异。</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Settings → 记忆: nightly tidying, a manual run, and a human-gated swap.
 *
 * The draft is the object under review: the review lists what each changed
 * file is about, not just its name, so confirming is an informed action.
 */
export function MemoryDreamSettings({ api }: { api?: MuseApiClient }) {
  const client = useMemo(
    () => api ?? new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [api],
  );
  const [state, setState] = useState<MemoryDreamState | null>(null);
  const [backups, setBackups] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<
    { runId: string; data: MemoryDreamReport } | null
  >(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await client.getMemoryDream();
      setState(next);
      setError(null);
      const target = (next.targets ?? [])[0];
      if (target) {
        const listed = await client.listMemoryDreamBackups(target.id);
        setBackups(listed.backups ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [refresh]);

  const runs = state?.runs ?? [];
  const running = runs.some((run) => run.status === "running");
  useEffect(() => {
    if (!running) {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current === null) {
      pollRef.current = window.setInterval(() => {
        setNow(Date.now());
        void refresh();
      }, 2000);
    }
  }, [running, refresh]);

  const target = (state?.targets ?? [])[0];
  const latestRuns = runs.slice(0, 6);
  const runningRun = runs.find((run) => run.status === "running");

  const toggle = async (enabled: boolean) => {
    setBusy("toggle");
    setNotice(null);
    try {
      await client.setMemoryDreamEnabled(enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    if (!target) return;
    setBusy("run");
    setNotice("已开始整理；跑完会出现在下面，等你确认。");
    try {
      await client.runMemoryDream(target.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleDraft = async (run: MemoryDreamRunView) => {
    if (expandedRun === run.id) {
      setExpandedRun(null);
      setReport(null);
      return;
    }
    setExpandedRun(run.id);
    setReportOpen(false);
    setBusy(`draft:${run.id}`);
    try {
      const data = await client.getMemoryDreamReport(run.id);
      setReport({ runId: run.id, data });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExpandedRun(null);
    } finally {
      setBusy(null);
    }
  };

  const adopt = async (run: MemoryDreamRunView) => {
    const warnings = run.lint && !run.lint.ok
      ? `\n\n注意：草稿校验未过（孤儿 ${run.lint.orphans}、超 4 KB ${run.lint.overCap}）。替换不会修好这些，但也不会让记忆更差；会先备份，可回滚。`
      : "";
    if (
      !window.confirm(
        `用这次草稿替换当前记忆？会先备份现有记忆，替换后可以回滚。${warnings}`,
      )
    ) {
      return;
    }
    setBusy(run.id);
    setNotice(null);
    try {
      const result = await client.adoptMemoryDreamRun(
        run.id,
        run.status === "failed" || Boolean(run.lint && !run.lint.ok),
      );
      if (!result.ok) {
        setError(result.error ?? "替换失败");
      } else {
        setNotice("已替换。旧记忆已备份，可回滚。");
        setExpandedRun(null);
        setReport(null);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const discard = async (run: MemoryDreamRunView) => {
    if (!window.confirm("丢弃这次草稿？记忆不会变。")) return;
    setBusy(run.id);
    try {
      await client.discardMemoryDreamRun(run.id);
      setExpandedRun(null);
      setReport(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveModel = async (model: string) => {
    if (!target) return;
    setBusy("model");
    try {
      await client.updateMemoryDreamTarget(target.id, { model });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const rollbackLatest = async () => {
    if (!target || backups.length === 0) return;
    if (!window.confirm("把记忆回滚到上一次替换之前的版本？当前版本也会先备份。")) {
      return;
    }
    setBusy("rollback");
    setNotice(null);
    try {
      const result = await client.rollbackMemoryDream(target.id, backups[0]);
      if (!result.ok) {
        setError(result.error ?? "回滚失败");
      } else {
        setNotice("已回滚。");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const elapsed = runningRun
    ? formatDuration(now - runningRun.startedAt)
    : "";

  return (
    <div className="md-root">
      <header className="md-header">
        <h3>记忆整理</h3>
        <p>
          助手会把跨会话学到的东西写进记忆。整理做三件事：收编没进索引的记忆、
          合并重复条目、把过期结论降级。整理只在副本上做，确认后才替换。
        </p>
      </header>

      <div className="md-card md-toggle-card">
        <div className="md-toggle-text">
          <div className="md-toggle-title">每晚自动整理</div>
          <div className="md-toggle-hint">
            每天 03:00 检查一次；没有新变化就跳过。自动整理只产草稿，不直接替换。
          </div>
        </div>
        <Switch
          checked={state?.enabled ?? false}
          disabled={!state || busy === "toggle"}
          onCheckedChange={(checked) => void toggle(checked)}
          aria-label="每晚自动整理记忆"
        />
      </div>

      {error ? <p className="md-error">{error}</p> : null}
      {notice ? <p className="md-notice">{notice}</p> : null}

      {target ? (
        <div className="md-card md-target-card">
          <div className="md-target-head">
            <div>
              <div className="md-target-title">{target.label}</div>
              <div className="md-target-sub">
                上次整理 {formatWhen(target.lastRunAt)}
              </div>
            </div>
            <Button
              size="2"
              variant="soft"
              disabled={running || busy === "run"}
              onClick={() => void runNow()}
            >
              {running ? "整理中…" : "立即整理"}
            </Button>
          </div>

          <div className="md-metrics">
            <div className="md-metric">
              <strong>{target.lastSummary?.files ?? "—"}</strong>
              <span>文件</span>
            </div>
            <div className="md-metric">
              <strong>{target.lastSummary?.orphans ?? "—"}</strong>
              <span>孤儿</span>
            </div>
            <div className="md-metric">
              <strong>{target.lastSummary?.indexChars ?? "—"}</strong>
              <span>索引字符</span>
            </div>
          </div>

          <div className="md-model-row">
            <span className="md-model-label">整理模型</span>
            <MuseModelSelect
              api={client}
              modelId={target.model ?? ""}
              allowEmpty
              emptyLabel="跟随默认模型"
              showTooltip={false}
              testId="memory-dream-model"
              onModelChange={(modelId) => void saveModel(modelId)}
            />
          </div>

          {running ? (
            <div className="md-progress">
              <Progress
                size="2"
                value={
                  runningRun?.progress?.total
                    ? Math.round(
                        ((runningRun.progress.index ?? 0) /
                          runningRun.progress.total) *
                          100,
                      )
                    : undefined
                }
              />
              <div className="md-progress-line">
                <span>{phaseText(runningRun?.progress)}</span>
                {elapsed ? <span>已用 {elapsed}</span> : null}
              </div>
            </div>
          ) : (
            <p className="md-target-hint">
              手动整理只写草稿；跑完在下面确认，才会替换记忆。
            </p>
          )}
        </div>
      ) : (
        <p className="md-empty">助手记忆还没有就绪。</p>
      )}

      {latestRuns.length > 0 ? (
        <section className="md-runs">
          <div className="md-section-head">
            <h4>最近整理</h4>
            {backups.length > 0 ? (
              <button
                type="button"
                className="md-link-btn"
                disabled={busy === "rollback"}
                onClick={() => void rollbackLatest()}
              >
                回滚到上一次替换前
              </button>
            ) : null}
          </div>

          {latestRuns.map((run) => {
            const badge = statusBadge(run);
            const canAdopt =
              run.draftReady &&
              (run.status === "succeeded" || run.status === "failed") &&
              !run.adoptedAt &&
              !run.discardedAt;
            const isOpen = expandedRun === run.id;
            return (
              <div key={run.id} className="md-card md-run-card">
                <div className="md-run-head">
                  <div className="md-run-title">
                    <Badge color={badge.color} variant="soft" size="1">
                      {badge.label}
                    </Badge>
                    <span className="md-run-when">
                      {formatWhen(run.startedAt)} ·{" "}
                      {run.trigger === "manual" ? "手动" : "定时"}
                    </span>
                    {run.skipReason ? (
                      <span className="md-run-reason">{run.skipReason}</span>
                    ) : null}
                  </div>
                  <div className="md-run-actions">
                    {run.draftReady ? (
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => void toggleDraft(run)}
                      >
                        {isOpen ? "收起草稿" : "查看草稿"}
                      </Button>
                    ) : null}
                    {canAdopt ? (
                      <>
                        <Button
                          size="1"
                          disabled={busy === run.id}
                          onClick={() => void adopt(run)}
                        >
                          {run.status === "failed" ? "仍然替换" : "确认替换"}
                        </Button>
                        <Button
                          size="1"
                          variant="ghost"
                          color="gray"
                          disabled={busy === run.id}
                          onClick={() => void discard(run)}
                        >
                          丢弃
                        </Button>
                      </>
                    ) : null}
                    {!run.draftReady && run.status === "succeeded" && run.summary ? (
                      <span className="md-run-stats">
                        {run.summary.files} 条 · 孤儿 {run.summary.orphans}
                      </span>
                    ) : null}
                  </div>
                </div>

                {run.error ? <p className="md-run-error">{run.error}</p> : null}
                {run.lint && !run.lint.ok ? (
                  <p className="md-run-lint">
                    草稿校验：孤儿 {run.lint.orphans} · 超 4 KB{" "}
                    {run.lint.overCap} · 断链 {run.lint.dangling} · 索引{" "}
                    {run.lint.indexChars} 字符
                  </p>
                ) : null}

                {isOpen && report?.runId === run.id ? (
                  <DraftReview
                    data={report.data}
                    open
                    reportOpen={reportOpen}
                    onToggleReport={() => setReportOpen((value) => !value)}
                  />
                ) : null}
                {isOpen && busy === `draft:${run.id}` ? (
                  <p className="md-empty">读取草稿…</p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
