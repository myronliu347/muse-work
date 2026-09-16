import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MuseApiClient,
  MuseAutomation,
  MuseAutomationRun,
  MuseAutomationTrigger,
  MuseIssueEvent,
  MuseScheduleUi,
} from "../../muse/apiClient";
import { MuseModelSelect } from "../shared/MuseModelSelect";
import { pickDirectoryViaHost } from "../issue/OpenPlanningDialog";
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

export const AutomationEditor: React.FC<{
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
  const [runs, setRuns] = useState<MuseAutomationRun[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openRun, setOpenRun] = useState<MuseAutomationRun | null>(null);
  const [dirs, setDirs] = useState<string[]>(() => {
    const set = new Set(recentWorkdirs.filter(Boolean));
    if (automation.workdir) set.add(automation.workdir);
    return [...set];
  });
  const skipFirstSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await api.listAutomationRuns(automation.id);
    setRuns(res.runs);
  }, [api, automation.id]);

  useEffect(() => {
    void loadRuns().catch(() => undefined);
  }, [loadRuns]);

  const persist = useCallback(
    async (next: {
      name: string;
      prompt: string;
      workdir: string;
      model: string;
      triggers: EditorTrigger[];
    }) => {
      const compiled = compileEditorTriggers(next.triggers);
      const { automation: saved } = await api.patchAutomation(automation.id, {
        name: next.name,
        prompt: next.prompt,
        workdir: next.workdir,
        model: next.model || undefined,
        triggers: compiled,
      });
      onChanged(saved);
    },
    [api, automation.id, onChanged],
  );

  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist({ name, prompt, workdir, model, triggers }).catch(() =>
        undefined,
      );
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [name, prompt, workdir, model, triggers, persist]);

  const toggleEnabled = async () => {
    try {
      const res = enabled
        ? await api.disableAutomation(automation.id)
        : await api.enableAutomation(automation.id);
      setEnabled(res.automation.enabled);
      onChanged(res.automation);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "无法切换启用状态");
    }
  };

  const pickDir = async () => {
    const path = await pickDirectoryViaHost(postToHost);
    if (!path) return;
    setDirs((prev) => (prev.includes(path) ? prev : [path, ...prev]));
    setWorkdir(path);
  };

  const onDirChange = (value: string) => {
    if (value === "__pick__") {
      void pickDir();
      return;
    }
    setWorkdir(value);
  };

  const runNow = async () => {
    if (!enabled) return;
    try {
      await api.runAutomation(automation.id);
      setTab("history");
      await loadRuns();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "运行失败");
    }
  };

  const remove = async () => {
    await api.deleteAutomation(automation.id);
    onDeleted();
  };

  return (
    <div className="automations-page-inner" data-testid="automation-editor">
      <button type="button" className="automations-back" onClick={onBack}>
        ← 全部自动化
      </button>
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
        <select
          value={workdir}
          onChange={(e) => onDirChange(e.target.value)}
          data-testid="automation-workdir"
        >
          <option value="">选择工作目录</option>
          {dirs.map((dir) => (
            <option key={dir} value={dir}>
              {dir}
            </option>
          ))}
          <option value="__pick__">选择目录…</option>
        </select>
        <span className="div" />
        <span>权限 · 工作区</span>
        <span className="automations-grow" />
        <button
          type="button"
          className="automations-btn"
          data-testid="automation-run-now"
          disabled={!enabled}
          onClick={() => void runNow()}
        >
          立即运行
        </button>
        <button
          type="button"
          className="automations-btn automations-btn-danger"
          onClick={() => setConfirmDelete(true)}
        >
          删除
        </button>
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
        <div>
          <div className="automations-sec-label">触发器</div>
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
          <div className="automations-menu">
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
          <div className="automations-sec-label" style={{ marginTop: 28 }}>
            Agent 指令
          </div>
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
              />
            </div>
          </div>
        </div>
      ) : (
        <div>
          {runs.length === 0 ? (
            <div className="automations-empty">还没有运行</div>
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
                <span>
                  <div>
                    {statusLabel(run.status)} · {runKind(run)}
                  </div>
                  <div className="automations-mono">
                    {new Date(run.startedAt).toLocaleString()}
                    {run.error ? ` · ${run.error}` : ""}
                  </div>
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {openRun ? (
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
      ) : null}
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

const TriggerCard: React.FC<{
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
            className="automations-btn automations-btn-ghost"
            onClick={onRemove}
          >
            移除
          </button>
        </div>
        <div className="automations-checks">
          {ISSUE_EVENTS.map((event) => (
            <label key={event.value}>
              <input
                type="checkbox"
                checked={trigger.events.includes(event.value)}
                onChange={(e) => {
                  const events = e.target.checked
                    ? [...trigger.events, event.value]
                    : trigger.events.filter((item) => item !== event.value);
                  onChange({ ...trigger, events });
                }}
              />{" "}
              {event.label}
            </label>
          ))}
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
          className="automations-btn automations-btn-ghost"
          onClick={onRemove}
        >
          移除
        </button>
      </div>
      {trigger.mode === "cycle" && trigger.rawCron ? (
        <div className="automations-pill">{trigger.rawCron}</div>
      ) : (
        <>
          <div className="automations-sec-label">
            执行频率{" "}
            <span className="automations-hint">高峰期可能排队，非高峰更稳定</span>
          </div>
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
                      at: "",
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
              <span>每</span>
              <select
                value={trigger.every}
                onChange={(e) =>
                  onChange({ ...trigger, every: Number(e.target.value) })
                }
              >
                {(trigger.unit === "h" ? HOUR_INTERVALS : MINUTE_INTERVALS).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ),
                )}
              </select>
              <select
                value={trigger.unit}
                onChange={(e) => {
                  const unit = e.target.value as "h" | "m";
                  const allowed: readonly number[] =
                    unit === "h" ? HOUR_INTERVALS : MINUTE_INTERVALS;
                  const every = allowed.includes(trigger.every)
                    ? trigger.every
                    : allowed[0];
                  onChange({ ...trigger, unit, every });
                }}
              >
                <option value="h">小时</option>
                <option value="m">分钟</option>
              </select>
            </div>
          ) : trigger.mode === "once" ? (
            <div className="automations-freq-row">
              <input
                type="datetime-local"
                value={trigger.at}
                onChange={(e) => onChange({ ...trigger, at: e.target.value })}
              />
            </div>
          ) : (
            <div className="automations-freq-row">
              <select
                value={trigger.cycle}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    cycle: e.target.value as typeof trigger.cycle,
                  })
                }
              >
                {CYCLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="automations-chip">
                <input
                  type="time"
                  value={trigger.time}
                  onChange={(e) =>
                    onChange({ ...trigger, time: e.target.value })
                  }
                  style={{ border: "none", background: "transparent", padding: 0 }}
                />
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
