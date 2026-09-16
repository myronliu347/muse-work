import type {
  MuseAutomationTrigger,
  MuseIssueEvent,
  MuseScheduleUi,
} from "../../muse/apiClient";

/** Must stay in sync with packages/server/src/services/scheduleCompile.ts */
export const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12] as const;
export const MINUTE_INTERVALS = [1, 5, 10, 15, 30] as const;

const HOUR_SET = new Set<number>(HOUR_INTERVALS);
const MINUTE_SET = new Set<number>(MINUTE_INTERVALS);

export const CYCLE_OPTIONS: Array<{
  value: Extract<MuseScheduleUi, { mode: "cycle" }>["cycle"];
  label: string;
}> = [
  { value: "daily", label: "每天" },
  { value: "weekday", label: "工作日" },
  { value: "1", label: "每周一" },
  { value: "2", label: "每周二" },
  { value: "3", label: "每周三" },
  { value: "4", label: "每周四" },
  { value: "5", label: "每周五" },
  { value: "6", label: "每周六" },
  { value: "0", label: "每周日" },
];

export const ISSUE_EVENTS: Array<{ value: MuseIssueEvent; label: string }> = [
  { value: "created", label: "创建" },
  { value: "review", label: "待审核" },
  { value: "completed", label: "完成" },
  { value: "cancelled", label: "取消" },
];

function parseTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw new Error("invalid time");
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("invalid time");
  }
  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function compileIssueTrigger(input: {
  events: MuseIssueEvent[];
  tags?: string[];
  priority?: "p0" | "p1" | "p2";
}): Extract<MuseAutomationTrigger, { type: "issue" }> {
  const trigger: Extract<MuseAutomationTrigger, { type: "issue" }> = {
    type: "issue",
    events: [...input.events],
  };
  if (input.tags && input.tags.length > 0) {
    trigger.tags = [...input.tags];
  }
  if (input.priority) {
    trigger.priority = input.priority;
  }
  return trigger;
}

export function compileSchedule(ui: MuseScheduleUi): MuseAutomationTrigger {
  if (ui.mode === "once") {
    return { type: "once", at: ui.at };
  }
  if (ui.mode === "interval") {
    if (ui.unit === "h") {
      if (!HOUR_SET.has(ui.every)) throw new Error("invalid interval");
      return { type: "cron", expr: `0 */${ui.every} * * *` };
    }
    if (!MINUTE_SET.has(ui.every)) throw new Error("invalid interval");
    return { type: "cron", expr: `*/${ui.every} * * * *` };
  }
  const { hour, minute } = parseTime(ui.time);
  const dow =
    ui.cycle === "daily" ? "*" : ui.cycle === "weekday" ? "1-5" : ui.cycle;
  return { type: "cron", expr: `${minute} ${hour} * * ${dow}` };
}

export function decodeCron(
  expr: string,
): Extract<MuseScheduleUi, { mode: "cycle" | "interval" }> | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = parts;
  if (domF !== "*" || monF !== "*") return null;

  if (/^\*\/(\d+)$/.test(minF) && hourF === "*" && dowF === "*") {
    const every = Number(minF.slice(2));
    if (MINUTE_SET.has(every)) return { mode: "interval", every, unit: "m" };
    return null;
  }
  if (minF === "0" && /^\*\/(\d+)$/.test(hourF) && dowF === "*") {
    const every = Number(hourF.slice(2));
    if (HOUR_SET.has(every)) return { mode: "interval", every, unit: "h" };
    return null;
  }
  if (!/^\d+$/.test(minF) || !/^\d+$/.test(hourF)) return null;
  const minute = Number(minF);
  const hour = Number(hourF);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  const time = formatTime(hour, minute);
  if (dowF === "*") return { mode: "cycle", cycle: "daily", time };
  if (dowF === "1-5") return { mode: "cycle", cycle: "weekday", time };
  if (/^[0-6]$/.test(dowF)) {
    return {
      mode: "cycle",
      cycle: dowF as "0" | "1" | "2" | "3" | "4" | "5" | "6",
      time,
    };
  }
  return null;
}

export function cycleLabel(cycle: string): string {
  return CYCLE_OPTIONS.find((x) => x.value === cycle)?.label ?? cycle;
}

export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function summarizeTrigger(trigger: MuseAutomationTrigger): string {
  if (trigger.type === "issue") {
    const labels = trigger.events
      .map((e) => ISSUE_EVENTS.find((x) => x.value === e)?.label ?? e)
      .join("/");
    return labels ? `Issue · ${labels}` : "Issue";
  }
  if (trigger.type === "once") {
    return `单次 ${new Date(trigger.at).toLocaleString()}`;
  }
  const decoded = decodeCron(trigger.expr);
  if (decoded?.mode === "interval") {
    return `每 ${decoded.every} ${decoded.unit === "h" ? "小时" : "分钟"}`;
  }
  if (decoded?.mode === "cycle") {
    return `${cycleLabel(decoded.cycle)} ${decoded.time}`;
  }
  return "定时";
}
