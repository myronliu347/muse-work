import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactElement,
} from "react";
import { Button, DropdownMenu, Select } from "@radix-ui/themes";
import type {
  MuseApiClient,
  MuseAutomation,
  MuseAutomationRun,
  MuseAutomationTrigger,
  MuseIssueEvent,
  MuseScheduleUi,
} from "../../muse/apiClient";
import { MuseModelSelect } from "../shared/MuseModelSelect";
import { MoreIcon } from "../shared/HeaderIcons";
import { pickDirectoryViaHost } from "../issue/OpenPlanningDialog";
import { DesktopWorkdirSelector } from "../desktop/DesktopWorkdirSelector";
import { getOverlayHost } from "../../utils/bodyPortal";
import { AutomationTranscript } from "./AutomationTranscript";
import {
  CYCLE_OPTIONS,
  HOUR_INTERVALS,
  ISSUE_EVENTS,
  MINUTE_INTERVALS,
  compileIssueTrigger,
  compileSchedule,
  decodeCron,
  toDatetimeLocal,
} from "./scheduleUi";
import { isNewAutomation } from "./automationDraft";

type PostToHost = (msg: Record<string, unknown>) => void;

type EditorTrigger =
  | {
      localId: string;
      kind: "issue";
      events: MuseIssueEvent[];
      tags?: string[];
      priority?: "p0" | "p1" | "p2";
    }
  | {
      localId: string;
      kind: "schedule";
      mode: "cycle";
      cycle: Extract<MuseScheduleUi, { mode: "cycle" }>["cycle"];
      time: string;
      rawCron?: string;
    }
  | {
      localId: string;
      kind: "schedule";
      mode: "interval";
      every: number;
      unit: "h" | "m";
    }
  | {
      localId: string;
      kind: "schedule";
      mode: "once";
      at: string;
    };

function fromServer(triggers: MuseAutomationTrigger[]): EditorTrigger[] {
  return triggers.map((trigger, index) => {
    if (trigger.type === "issue") {
      return {
        localId: `t${index}`,
        kind: "issue",
        events: trigger.events,
        tags: trigger.tags,
        priority: trigger.priority,
      };
    }
    if (trigger.type === "once") {
      return {
        localId: `t${index}`,
        kind: "schedule",
        mode: "once",
        at: toDatetimeLocal(trigger.at),
      };
    }
    const decoded = decodeCron(trigger.expr);
    if (decoded?.mode === "interval") {
      return {
        localId: `t${index}`,
        kind: "schedule",
        mode: "interval",
        every: decoded.every,
        unit: decoded.unit,
      };
    }
    if (decoded?.mode === "cycle") {
      return {
        localId: `t${index}`,
        kind: "schedule",
        mode: "cycle",
        cycle: decoded.cycle,
        time: decoded.time,
      };
    }
    return {
      localId: `t${index}`,
      kind: "schedule",
      mode: "cycle",
      cycle: "daily",
      time: "09:00",
      rawCron: trigger.expr,
    };
  });
}

function compileEditorTriggers(triggers: EditorTrigger[]): MuseAutomationTrigger[] {
  const out: MuseAutomationTrigger[] = [];
  for (const trigger of triggers) {
    if (trigger.kind === "issue") {
      if (trigger.events.length === 0) continue;
      out.push(
        compileIssueTrigger({
          events: trigger.events,
          tags: trigger.tags,
          priority: trigger.priority,
        }),
      );
      continue;
    }
    if (trigger.mode === "once") {
      if (!trigger.at) continue;
      const at = new Date(trigger.at).getTime();
      if (!Number.isFinite(at)) continue;
      out.push({ type: "once", at });
      continue;
    }
    if (trigger.mode === "interval") {
      out.push(
        compileSchedule({
          mode: "interval",
          every: trigger.every,
          unit: trigger.unit,
        }),
      );
      continue;
    }
    if (trigger.rawCron) {
      out.push({ type: "cron", expr: trigger.rawCron });
      continue;
    }
    out.push(
      compileSchedule({
        mode: "cycle",
        cycle: trigger.cycle,
        time: trigger.time,
      }),
    );
  }
  return out;
}

function draftKey(input: {
  name: string;
  prompt: string;
  workdir: string;
  model: string;
  triggers: EditorTrigger[];
}): string {
  return JSON.stringify({
    name: input.name,
    prompt: input.prompt,
    workdir: input.workdir,
    model: input.model,
    triggers: compileEditorTriggers(input.triggers),
  });
}

function statusLabel(status: MuseAutomationRun["status"]): string {
  return (
    {
      running: "执行中",
      succeeded: "成功",
      failed: "失败",
      stopped: "已停止",
      skipped: "已跳过",
    }[status] ?? status
  );
}

function runKind(run: MuseAutomationRun): string {
  if (run.trigger.type === "manual") return "手动";
  if (run.trigger.type === "issue") {
    return `Issue · ${run.trigger.issue?.title ?? run.trigger.issue?.id ?? ""}`;
  }
  return "定时";
}

function newId(): string {
  return `t${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const CLOCK_HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: pad2(i),
  label: pad2(i),
}));
const CLOCK_MINUTES = Array.from({ length: 60 }, (_, i) => ({
  value: pad2(i),
  label: pad2(i),
}));
const CLOCK_MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: pad2(i + 1),
  label: `${i + 1}月`,
}));
const INTERVAL_ITEMS = [
  ...HOUR_INTERVALS.map((n) => ({
    value: `h:${n}`,
    label: `每 ${n} 小时`,
  })),
  ...MINUTE_INTERVALS.map((n) => ({
    value: `m:${n}`,
    label: `每 ${n} 分钟`,
  })),
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function splitTime(time: string): { hour: string; minute: string } {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return { hour: match?.[1] ?? "09", minute: match?.[2] ?? "00" };
}

function splitDatetimeLocal(value: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return {
      year: String(next.getFullYear()),
      month: pad2(next.getMonth() + 1),
      day: pad2(next.getDate()),
      hour: "09",
      minute: "00",
    };
  }
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
  };
}

function joinDatetimeLocal(parts: {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}): string {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const maxDay = daysInMonth(year, month);
  const day = Math.min(Number(parts.day) || 1, maxDay);
  return `${parts.year}-${parts.month}-${pad2(day)}T${parts.hour}:${parts.minute}`;
}

function formatRunAt(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultOnceAt(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return toDatetimeLocal(next.getTime());
}

function yearItems(current: string): Array<{ value: string; label: string }> {
  const start = new Date().getFullYear();
  const years = new Set([current, String(start), String(start + 1), String(start + 2)]);
  return [...years]
    .filter((year) => /^\d{4}$/.test(year))
    .sort()
    .map((year) => ({ value: year, label: `${year}年` }));
}

function explainAutomationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("incomplete")) {
    return "启用前需要指令、工作目录和至少一个触发器。";
  }
  if (raw.includes("disabled")) {
    return "停用时不能测试，请先启用。";
  }
  return raw.replace(/^Muse API \d+:\s*/, "") || "操作失败";
}

export const AutomationEditor: FC<{
  api: MuseApiClient;
  automation: MuseAutomation;
  recentWorkdirs: string[];
  postToHost: PostToHost;
  onBack: () => void;
  onChanged: (automation: MuseAutomation) => void;
  onDeleted: () => void;
}> = ({
  api,
  automation,
  recentWorkdirs,
  postToHost,
  onBack,
  onChanged,
  onDeleted,
}) => {
  const [name, setName] = useState(automation.name);
  const [enabled, setEnabled] = useState(automation.enabled);
  const [workdir, setWorkdir] = useState(automation.workdir);
  const [prompt, setPrompt] = useState(automation.prompt);
  const [model, setModel] = useState(automation.model ?? "");
  const [triggers, setTriggers] = useState<EditorTrigger[]>(() =>
    fromServer(automation.triggers),
  );
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const [trigMenu, setTrigMenu] = useState(false);
  const trigMenuRef = useRef<HTMLDivElement>(null);
  const [runs, setRuns] = useState<MuseAutomationRun[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openRun, setOpenRun] = useState<MuseAutomationRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirs, setDirs] = useState<string[]>(() => {
    const set = new Set(recentWorkdirs.filter(Boolean));
    if (automation.workdir) set.add(automation.workdir);
    return [...set];
  });
  const baseline = useRef(
    draftKey({
      name: automation.name,
      prompt: automation.prompt,
      workdir: automation.workdir,
      model: automation.model ?? "",
      triggers: fromServer(automation.triggers),
    }),
  );

  const dirty = useMemo(
    () => draftKey({ name, prompt, workdir, model, triggers }) !== baseline.current,
    [name, prompt, workdir, model, triggers],
  );

  const loadRuns = useCallback(async () => {
    if (isNewAutomation(automation.id)) {
      setRuns([]);
      return;
    }
    const res = await api.listAutomationRuns(automation.id);
    setRuns(res.runs);
  }, [api, automation.id]);

  useEffect(() => {
    void loadRuns().catch(() => undefined);
  }, [loadRuns]);

  useEffect(() => {
    if (!trigMenu) return;
    const onDown = (event: MouseEvent) => {
      if (
        trigMenuRef.current &&
        event.target instanceof Node &&
        !trigMenuRef.current.contains(event.target)
      ) {
        setTrigMenu(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [trigMenu]);

  const persist = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const compiled = compileEditorTriggers(triggers);
      const patch = {
        name,
        prompt,
        workdir,
        model: model || undefined,
        triggers: compiled,
      };
      const { automation: saved } = isNewAutomation(automation.id)
        ? await api.createAutomation(patch)
        : await api.patchAutomation(automation.id, patch);
      baseline.current = draftKey({ name, prompt, workdir, model, triggers });
      onChanged(saved);
      return saved;
    } catch (err) {
      setError(explainAutomationError(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [api, automation.id, model, name, onChanged, prompt, triggers, workdir]);

  const toggleEnabled = async () => {
    if (!enabled) {
      const compiled = compileEditorTriggers(triggers);
      if (!prompt.trim() || !workdir.trim() || compiled.length === 0) {
        setError("启用前需要指令、工作目录和至少一个触发器。");
        return;
      }
      if (dirty) {
        try {
          await persist();
        } catch {
          return;
        }
      }
    }
    try {
      setError(null);
      const savedId = isNewAutomation(automation.id)
        ? undefined
        : automation.id;
      if (!savedId) {
        return;
      }
      const res = enabled
        ? await api.disableAutomation(savedId)
        : await api.enableAutomation(savedId);
      setEnabled(res.automation.enabled);
      onChanged(res.automation);
    } catch (err) {
      setError(explainAutomationError(err));
    }
  };

  const pickDir = async () => {
    const path = await pickDirectoryViaHost(postToHost);
    if (!path) return;
    setDirs((prev) => (prev.includes(path) ? prev : [path, ...prev]));
    setWorkdir(path);
  };

  const save = async () => {
    if (!dirty || saving) return;
    try {
      await persist();
    } catch {
      /* banner already set */
    }
  };

  const goBack = async () => {
    if (isNewAutomation(automation.id)) {
      onBack();
      return;
    }
    if (dirty) {
      try {
        await persist();
      } catch {
        return;
      }
    }
    onBack();
  };

  const runNow = async () => {
    if (!enabled) return;
    try {
      setError(null);
      if (dirty) await persist();
      await api.runAutomation(automation.id);
      setTab("history");
      const res = await api.listAutomationRuns(automation.id);
      setRuns(res.runs);
      if (res.runs[0]) setOpenRun(res.runs[0]);
    } catch (err) {
      setError(explainAutomationError(err));
    }
  };

  const remove = async () => {
    if (!isNewAutomation(automation.id)) {
      await api.deleteAutomation(automation.id);
    }
    onDeleted();
  };

  const title = name.trim() || "未命名";

  return (
    <div className="automations-editor" data-testid="automation-editor">
      <header className="automations-ed-chrome">
        <nav className="automations-crumb" aria-label="面包屑">
          <button type="button" onClick={() => void goBack()}>
            自动化
          </button>
          <span className="automations-crumb-sep" aria-hidden="true">
            ›
          </span>
          <span className="automations-crumb-current" title={title}>
            {title}
          </span>
        </nav>
        <div className="automations-ed-actions">
          <Button
            size="1"
            variant="soft"
            color="gray"
            highContrast
            disabled={!dirty || saving}
            onClick={() => void save()}
            data-testid="automation-save"
          >
            保存
          </Button>
          <Button
            size="1"
            variant="soft"
            color="gray"
            highContrast
            disabled={!enabled}
            onClick={() => void runNow()}
            data-testid="automation-run-now"
          >
            <span className="codicon codicon-play" aria-hidden="true" />
            测试
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button
                type="button"
                className="automations-more"
                aria-label="更多"
                data-testid="automation-more"
              >
                <MoreIcon className="header-icon" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              size="1"
              variant="soft"
              color="gray"
              highContrast
              align="end"
              sideOffset={4}
              container={getOverlayHost()}
            >
              <DropdownMenu.Item
                color="red"
                onSelect={() => setConfirmDelete(true)}
              >
                删除
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </header>
      <div className="automations-page-scroll">
        <div className="automations-page-inner automations-page-inner--editor">
          {error ? <div className="automations-banner">{error}</div> : null}
          <div
            className="automations-ed-title"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            data-testid="automation-title"
            ref={(el) => {
              if (el && el.dataset.ready !== "1") {
                el.dataset.ready = "1";
                el.textContent = automation.name;
              }
            }}
            onInput={(e) => setName(e.currentTarget.textContent?.trim() ?? "")}
          />
          <div className="automations-ed-meta">
            <button
              type="button"
              className={`automations-switch${enabled ? " on" : ""}`}
              aria-label="启用"
              onClick={() => void toggleEnabled()}
            >
              <i />
            </button>
            <span>{enabled ? "已启用" : "已停用"}</span>
            <span className="div" />
            <DesktopWorkdirSelector
              workdir={workdir || undefined}
              recentWorkdirs={dirs}
              menuPlacement="down"
              variant="ghost"
              testId="automation-workdir"
              onSelectWorkdir={() => void pickDir()}
              onSelectRecentWorkdir={(path) => {
                setDirs((prev) => (prev.includes(path) ? prev : [path, ...prev]));
                setWorkdir(path);
              }}
              onRemoveRecentWorkdir={(path) => {
                setDirs((prev) => prev.filter((dir) => dir !== path));
              }}
            />
            <span className="div" />
            <span>工作区</span>
          </div>
          <div className="automations-tabs">
            <button
              type="button"
              className={`automations-tab${tab === "settings" ? " on" : ""}`}
              onClick={() => setTab("settings")}
            >
              设置
            </button>
            <button
              type="button"
              className={`automations-tab${tab === "history" ? " on" : ""}`}
              onClick={() => {
                setTab("history");
                void loadRuns();
              }}
            >
              运行记录
            </button>
          </div>
          {tab === "settings" ? (
            <div className="automations-settings">
              <div className="automations-block">
                <div className="automations-sec-label">触发器</div>
                <div className="automations-trig-stack">
              {triggers.map((trigger) => (
                <TriggerCard
                  key={trigger.localId}
                  trigger={trigger}
                  onChange={(next) =>
                    setTriggers((prev) =>
                      prev.map((item) =>
                        item.localId === trigger.localId ? next : item,
                      ),
                    )
                  }
                  onRemove={() =>
                    setTriggers((prev) =>
                      prev.filter((item) => item.localId !== trigger.localId),
                    )
                  }
                />
              ))}
              <div className="automations-menu" ref={trigMenuRef}>
                <button
                  type="button"
                  className="automations-add-trig"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTrigMenu((open) => !open);
                  }}
                >
                  + 添加触发器
                </button>
                {trigMenu ? (
                  <div className="automations-menu-pop">
                    <button
                      type="button"
                      onClick={() => {
                        setTriggers((prev) => [
                          ...prev,
                          {
                            localId: newId(),
                            kind: "schedule",
                            mode: "cycle",
                            cycle: "daily",
                            time: "09:00",
                          },
                        ]);
                        setTrigMenu(false);
                      }}
                    >
                      定时调度
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTriggers((prev) => [
                          ...prev,
                          { localId: newId(), kind: "issue", events: [] },
                        ]);
                        setTrigMenu(false);
                      }}
                    >
                      Issue 生命周期
                    </button>
                  </div>
                ) : null}
              </div>
                </div>
              </div>
              <div className="automations-block">
                <div className="automations-sec-label">Agent 指令</div>
                <div className="automations-instr">
                  <textarea
                    value={prompt}
                    placeholder="输入指令。可用 @ 提及文件，/ 调用命令…"
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="automations-instr-model">
                    <MuseModelSelect
                      api={api}
                      modelId={model}
                      onModelChange={setModel}
                      allowEmpty
                      emptyLabel="默认模型"
                      showTooltip={false}
                      triggerVariant="ghost"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : openRun ? (
            <AutomationTranscript
              api={api}
              run={openRun}
              onClose={() => setOpenRun(null)}
              onStop={() => {
                void api.stopAutomationRun(openRun.id).then(() => {
                  setOpenRun({ ...openRun, status: "stopped" });
                  void loadRuns();
                });
              }}
            />
          ) : (
            <div className="automations-run-list">
              {runs.length === 0 ? (
                <div className="automations-empty-inline">还没有运行</div>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="automations-run"
                    onClick={() => setOpenRun(run)}
                  >
                    <span
                      className={`automations-dot ${
                        run.status === "running"
                          ? "run"
                          : run.status === "succeeded"
                            ? "ok"
                            : run.status === "skipped"
                              ? "skip"
                              : "fail"
                      }`}
                    />
                    <span className="automations-run-body">
                      {statusLabel(run.status)} · {runKind(run)}
                    </span>
                    <span className="automations-run-time">
                      {formatRunAt(run.startedAt)}
                      {run.error ? ` · ${run.error}` : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      {confirmDelete ? (
        <div className="confirm-dialog-overlay">
          <div className="confirm-dialog">
            <div className="confirm-dialog-title">删除这条自动化？</div>
            <div className="confirm-dialog-description">
              规则从列表消失。正在跑的会先停。
            </div>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-dialog-btn confirm-dialog-btn-cancel"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="confirm-dialog-btn confirm-dialog-btn-confirm"
                onClick={() => void remove()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const TriggerCard: FC<{
  trigger: EditorTrigger;
  onChange: (next: EditorTrigger) => void;
  onRemove: () => void;
}> = ({ trigger, onChange, onRemove }) => {
  if (trigger.kind === "issue") {
    return (
      <div className="automations-trig-card">
        <div className="automations-trig-top">
          <strong>Issue 生命周期</strong>
          <span className="automations-grow" />
          <button
            type="button"
            className="automations-link-btn"
            onClick={onRemove}
          >
            移除
          </button>
        </div>
        <div className="automations-checks">
          {ISSUE_EVENTS.map((event) => {
            const on = trigger.events.includes(event.value);
            return (
              <button
                key={event.value}
                type="button"
                className={`automations-check${on ? " on" : ""}`}
                onClick={() => {
                  const events = on
                    ? trigger.events.filter((item) => item !== event.value)
                    : [...trigger.events, event.value];
                  onChange({ ...trigger, events });
                }}
              >
                {event.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="automations-trig-card">
      <div className="automations-trig-top">
        <strong>定时调度</strong>
        <span className="automations-grow" />
          <button
            type="button"
            className="automations-link-btn"
            onClick={onRemove}
          >
            移除
          </button>
      </div>
      {trigger.mode === "cycle" && trigger.rawCron ? (
        <div className="automations-pill">{trigger.rawCron}</div>
      ) : (
        <>
          <div className="automations-seg">
            {(["cycle", "interval", "once"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={trigger.mode === mode ? "on" : ""}
                onClick={() => {
                  if (mode === "interval") {
                    onChange({
                      localId: trigger.localId,
                      kind: "schedule",
                      mode: "interval",
                      every: 1,
                      unit: "h",
                    });
                  } else if (mode === "once") {
                    onChange({
                      localId: trigger.localId,
                      kind: "schedule",
                      mode: "once",
                      at: defaultOnceAt(),
                    });
                  } else {
                    onChange({
                      localId: trigger.localId,
                      kind: "schedule",
                      mode: "cycle",
                      cycle: "daily",
                      time: "09:00",
                    });
                  }
                }}
              >
                {mode === "cycle" ? "周期" : mode === "interval" ? "按间隔" : "单次"}
              </button>
            ))}
          </div>
          {trigger.mode === "interval" ? (
            <div className="automations-freq-row">
              <SoftSelect
                value={`${trigger.unit}:${trigger.every}`}
                onValueChange={(value) => {
                  const [unit, every] = value.split(":");
                  onChange({
                    ...trigger,
                    unit: unit as "h" | "m",
                    every: Number(every),
                  });
                }}
                items={INTERVAL_ITEMS}
              />
            </div>
          ) : trigger.mode === "once" ? (
            <OnceFields
              value={trigger.at}
              onChange={(at) => onChange({ ...trigger, at })}
            />
          ) : (
            <div className="automations-freq-row">
              <SoftSelect
                value={trigger.cycle}
                onValueChange={(cycle) =>
                  onChange({
                    ...trigger,
                    cycle: cycle as typeof trigger.cycle,
                  })
                }
                items={CYCLE_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
              />
              <ClockFields
                time={trigger.time}
                onChange={(time) => onChange({ ...trigger, time })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

function ClockFields(props: {
  time: string;
  onChange: (time: string) => void;
}): ReactElement {
  const { hour, minute } = splitTime(props.time);
  return (
    <div className="automations-clock">
      <SoftSelect
        value={hour}
        onValueChange={(next) => props.onChange(`${next}:${minute}`)}
        items={CLOCK_HOURS}
      />
      <span className="automations-clock-sep">:</span>
      <SoftSelect
        value={minute}
        onValueChange={(next) => props.onChange(`${hour}:${next}`)}
        items={CLOCK_MINUTES}
      />
    </div>
  );
}

function OnceFields(props: {
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const parts = splitDatetimeLocal(props.value);
  const patch = (next: Partial<typeof parts>) =>
    props.onChange(joinDatetimeLocal({ ...parts, ...next }));
  const maxDay = daysInMonth(Number(parts.year), Number(parts.month));
  const dayItems = Array.from({ length: maxDay }, (_, i) => ({
    value: pad2(i + 1),
    label: `${i + 1}日`,
  }));
  return (
    <div className="automations-freq-row">
      <SoftSelect
        value={parts.year}
        onValueChange={(year) => patch({ year })}
        items={yearItems(parts.year)}
      />
      <SoftSelect
        value={parts.month}
        onValueChange={(month) => patch({ month })}
        items={CLOCK_MONTHS}
      />
      <SoftSelect
        value={pad2(Math.min(Number(parts.day) || 1, maxDay))}
        onValueChange={(day) => patch({ day })}
        items={dayItems}
      />
      <ClockFields
        time={`${parts.hour}:${parts.minute}`}
        onChange={(time) => {
          const { hour, minute } = splitTime(time);
          patch({ hour, minute });
        }}
      />
    </div>
  );
}

function SoftSelect(props: {
  value: string;
  onValueChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
}): ReactElement {
  return (
    <Select.Root value={props.value} onValueChange={props.onValueChange}>
      <Select.Trigger variant="soft" color="gray" />
      <Select.Content
        position="popper"
        color="gray"
        container={getOverlayHost()}
      >
        {props.items.map((item) => (
          <Select.Item key={item.value} value={item.value}>
            {item.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
