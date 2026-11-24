import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Progress, Switch } from "@radix-ui/themes";
import {
  MuseApiClient,
  type MemoryDreamProgress,
  type MemoryDreamReport,
  type MemoryDreamRuleView,
  type MemoryDreamRunView,
  type MemoryDreamSkillView,
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
    case "skills":
      return progress.detail ? `提取助手技能 · ${progress.detail}` : "提取助手技能";
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

function isFirstOccurrence(item: {
  explicit?: boolean;
  occurrenceDays?: number;
}): boolean {
  return !item.explicit && (item.occurrenceDays ?? 1) < 2;
}

function SkillRow({
  skill,
  busy,
  onAdopt,
  onReject,
}: {
  skill: MemoryDreamSkillView;
  busy: boolean;
  onAdopt: () => void;
  onReject: () => void;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="md-skill">
      <div className="md-skill-head">
        <Badge size="1" variant="soft" color={skill.action === "update" ? "amber" : "green"}>
          {skill.action === "update" ? "更新" : "新增"}
        </Badge>
        <span className="md-skill-name">{skill.name}</span>
        {isFirstOccurrence(skill) ? (
          <Badge size="1" variant="soft" color="gray">
            首次出现
          </Badge>
        ) : null}
        <span className="md-skill-confidence">
          置信度 {Math.round(skill.confidence * 100)}%
        </span>
        <Button
          size="1"
          disabled={busy || skill.adopted || !skill.lint.ok}
          onClick={onAdopt}
        >
          {skill.adopted ? "已采纳" : "采纳"}
        </Button>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          disabled={busy || skill.adopted}
          onClick={onReject}
        >
          忽略
        </Button>
      </div>
      <div className="md-skill-desc">{skill.description}</div>
      <div className="md-skill-meta">
        {skill.evidence.length > 0
          ? `证据：${skill.evidence
              .map((item) => item.day)
              .filter(Boolean)
              .join("、")}`
          : "证据：未标注"}
        {isFirstOccurrence(skill) ? " · 只出现过一次，建议再观察；仍可手动采纳" : ""}
        {skill.exists ? " · 会覆盖已有同名技能" : ""}
        {skill.lint.ok ? "" : ` · 校验未过：${skill.lint.issues.join("；")}`}
      </div>
      <button
        type="button"
        className="md-link-btn"
        onClick={() => setPreview((value) => !value)}
      >
        {preview ? "收起 SOP" : "预览 SOP"}
      </button>
      {preview ? <pre className="md-skill-preview">{skill.content}</pre> : null}
    </div>
  );
}

function RuleRow({
  rule,
  busy,
  onAdopt,
  onReject,
}: {
  rule: MemoryDreamRuleView;
  busy: boolean;
  onAdopt: () => void;
  onReject: () => void;
}) {
  return (
    <div className="md-skill">
      <div className="md-skill-head">
        <Badge size="1" variant="soft" color="amber">
          规则
        </Badge>
        <span className="md-skill-name">{rule.name}</span>
        {isFirstOccurrence(rule) ? (
          <Badge size="1" variant="soft" color="gray">
            首次出现
          </Badge>
        ) : null}
        <span className="md-skill-confidence">
          置信度 {Math.round(rule.confidence * 100)}%
        </span>
        <Button
          size="1"
          disabled={busy || rule.adopted || !rule.lint.ok}
          onClick={onAdopt}
        >
          {rule.adopted ? "已采纳" : "采纳"}
        </Button>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          disabled={busy || rule.adopted}
          onClick={onReject}
        >
          忽略
        </Button>
      </div>
      <div className="md-skill-desc">{rule.text}</div>
      <div className="md-skill-meta">
        {rule.evidence.length > 0
          ? `证据：${rule.evidence
              .map((item) => item.day)
              .filter(Boolean)
              .join("、")}`
          : "证据：未标注"}
        {isFirstOccurrence(rule) ? " · 只出现过一次，建议再观察；仍可手动采纳" : ""}
        {rule.exists ? " · 会覆盖已有规则" : ""}
        {rule.lint.ok ? "" : ` · 校验未过：${rule.lint.issues.join("；")}`}
        {" · 采纳后下一轮或下次会话生效"}
      </div>
    </div>
  );
}

function DraftReview({
  data,
  open,
  onToggleReport,
  reportOpen,
  onAdoptSkill,
  onAdoptRule,
  onRejectSkill,
  onRejectRule,
  onAdoptAllSafe,
  busySkill,
  busyRule,
  busyReject,
}: {
  data: MemoryDreamReport;
  open: boolean;
  onToggleReport: () => void;
  reportOpen: boolean;
  onAdoptSkill: (name: string) => void;
  onAdoptRule: (name: string) => void;
  onRejectSkill: (name: string) => void;
  onRejectRule: (name: string) => void;
  onAdoptAllSafe: () => void;
  busySkill?: string | null;
  busyRule?: string | null;
  busyReject?: string | null;
}) {
  const skills = data.skills ?? [];
  const rules = data.rules ?? [];
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
        <span className="md-chip is-change">规则 {rules.length}</span>
        <span className="md-chip is-add">技能 {skills.length}</span>
        <span className="md-chip">会话 {data.transcripts ?? 0}</span>
        {rules.some(
          (rule) => rule.lint.ok && !rule.adopted && !isFirstOccurrence(rule),
        ) ||
        skills.some(
          (skill) => skill.lint.ok && !skill.adopted && !isFirstOccurrence(skill),
        ) ? (
          <button
            type="button"
            className="md-link-btn md-review-adopt-all"
            onClick={onAdoptAllSafe}
          >
            采纳全部安全项
          </button>
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

          {rules.length === 0 && skills.length === 0 ? (
            <p className="md-empty">
              {data.transcripts === 0
                ? "这次没有新的助手会话记录，所以没有规则/技能候选。先到助手（小盏）页对话一次，再重新整理。"
                : "这次没有规则或技能草稿。旧版本生成的整理不会补生成；重启应用后重新整理一次。"}
            </p>
          ) : null}

          {rules.length > 0 ? (
            <div className="md-group">
              <div className="md-group-head">
                <span className="md-group-dot is-change" />
                <span className="md-group-title">助手规则</span>
                <span className="md-group-count">{rules.length}</span>
              </div>
              <div className="md-group-body">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.name}
                    rule={rule}
                    busy={busyRule === rule.name || busyReject === rule.name}
                    onAdopt={() => onAdoptRule(rule.name)}
                    onReject={() => onRejectRule(rule.name)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {skills.length > 0 ? (
            <div className="md-group">
              <div className="md-group-head">
                <span className="md-group-dot is-add" />
                <span className="md-group-title">助手技能</span>
                <span className="md-group-count">{skills.length}</span>
              </div>
              <div className="md-group-body">
                {skills.map((skill) => (
                  <SkillRow
                    key={skill.name}
                    skill={skill}
                    busy={busySkill === skill.name || busyReject === skill.name}
                    onAdopt={() => onAdoptSkill(skill.name)}
                    onReject={() => onRejectSkill(skill.name)}
                  />
                ))}
              </div>
            </div>
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

  const adoptRule = async (runId: string, name: string) => {
    const first = report?.runId === runId
      ? (report.data.rules ?? []).find((rule) => rule.name === name)
      : undefined;
    if (
      !window.confirm(
        `采纳规则“${name}”${first && isFirstOccurrence(first) ? "（只出现过一次，建议再观察）" : ""}？会先备份同名规则；规则在下次会话或重建助手后生效。`,
      )
    ) {
      return;
    }
    setBusy(`rule:${name}`);
    setNotice(null);
    try {
      const outcome = await client.adoptMemoryDreamRule(runId, name);
      if (!outcome.ok) throw new Error(outcome.error ?? "采纳失败");
      setNotice(
        outcome.effective === "next-turn"
          ? `已采纳规则“${name}”，下一轮生效。`
          : `已采纳规则“${name}”，下次会话生效。`,
      );
      const data = await client.getMemoryDreamReport(runId);
      setReport({ runId, data });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const adoptAllSafe = async (runId: string) => {
    const data = report?.runId === runId ? report.data : null;
    if (!data) return;
    const safeRules = (data.rules ?? []).filter(
      (rule) => rule.lint.ok && !rule.adopted && !isFirstOccurrence(rule),
    );
    const safeSkills = (data.skills ?? []).filter(
      (skill) => skill.lint.ok && !skill.adopted && !isFirstOccurrence(skill),
    );
    if (safeRules.length + safeSkills.length === 0) return;
    if (
      !window.confirm(
        `采纳 ${safeRules.length} 条规则、${safeSkills.length} 个技能？记忆仍需单独替换；规则会尽量在下一轮生效。`,
      )
    ) {
      return;
    }
    setBusy("adopt-all");
    setNotice(null);
    let failed = 0;
    for (const rule of safeRules) {
      const outcome = await client
        .adoptMemoryDreamRule(runId, rule.name)
        .catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      if (!outcome.ok) failed += 1;
    }
    for (const skill of safeSkills) {
      const outcome = await client
        .adoptMemoryDreamSkill(runId, skill.name)
        .catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      if (!outcome.ok) failed += 1;
    }
    try {
      const next = await client.getMemoryDreamReport(runId);
      setReport({ runId, data: next });
      await refresh();
      setNotice(
        failed === 0
          ? "已采纳全部安全项。"
          : `已采纳；${failed} 项失败，请看错误后重试。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const rejectDraft = async (
    runId: string,
    kind: "rule" | "skill",
    name: string,
  ) => {
    if (!window.confirm(`忽略“${name}”？以后相同内容不会再建议。`)) {
      return;
    }
    setBusy(`reject:${name}`);
    setNotice(null);
    try {
      const outcome = await client.rejectMemoryDreamDraft(runId, kind, name);
      if (!outcome.ok) throw new Error(outcome.error ?? "忽略失败");
      setNotice(`已忽略“${name}”。`);
      const data = await client.getMemoryDreamReport(runId);
      setReport({ runId, data });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const adoptSkill = async (runId: string, name: string) => {
    const first = report?.runId === runId
      ? (report.data.skills ?? []).find((skill) => skill.name === name)
      : undefined;
    if (
      !window.confirm(
        `采纳技能“${name}”${first && isFirstOccurrence(first) ? "（只出现过一次，建议再观察）" : ""}？会先备份同名技能，可回滚。`,
      )
    ) {
      return;
    }
    setBusy(`skill:${name}`);
    setNotice(null);
    try {
      const outcome = await client.adoptMemoryDreamSkill(runId, name);
      if (!outcome.ok) throw new Error(outcome.error ?? "采纳失败");
      setNotice(`已采纳技能“${name}”。`);
      const data = await client.getMemoryDreamReport(runId);
      setReport({ runId, data });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    if (
      !window.confirm(
        "丢弃这次草稿？记忆不会变；下次整理会重新读取这段会话。",
      )
    ) {
      return;
    }
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
          助手会把跨会话学到的东西写进记忆、规则和技能。整理做三件事：收编/合并记忆、
          提取总是适用的规则、把同一类工作沉淀成技能草稿。整理只在副本上做，确认后才替换。
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
                {run.skillError ? (
                  <p className="md-run-lint">技能提取失败：{run.skillError}</p>
                ) : null}
                {run.fallbackIndex ? (
                  <p className="md-run-lint">
                    这一轮 AI 没在轮次内补全索引，程序只补了缺失的指针，没有替它决定归档；建议看一遍草稿里的
                    MEMORY.md。
                  </p>
                ) : null}
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
                    onAdoptSkill={(name) => void adoptSkill(run.id, name)}
                    onAdoptRule={(name) => void adoptRule(run.id, name)}
                    onRejectSkill={(name) => void rejectDraft(run.id, "skill", name)}
                    onRejectRule={(name) => void rejectDraft(run.id, "rule", name)}
                    onAdoptAllSafe={() => void adoptAllSafe(run.id)}
                    busySkill={busy?.startsWith("skill:") ? busy.slice(6) : null}
                    busyRule={busy?.startsWith("rule:") ? busy.slice(5) : null}
                    busyReject={busy?.startsWith("reject:") ? busy.slice(7) : null}
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
