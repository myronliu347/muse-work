import type { AutomationTrigger } from "./automationStore.js";

export type ScheduleUi =
  | {
      mode: "cycle";
      cycle: "daily" | "weekday" | "0" | "1" | "2" | "3" | "4" | "5" | "6";
      time: string;
    }
  | { mode: "interval"; every: number; unit: "h" | "m" }
  | { mode: "once"; at: number };

const HOUR_INTERVALS = new Set([1, 2, 3, 4, 6, 8, 12]);
const MINUTE_INTERVALS = new Set([1, 5, 10, 15, 30]);

function parseTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) {
    throw new Error("invalid time");
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    m[1].length !== 2 ||
    m[2].length !== 2
  ) {
    throw new Error("invalid time");
  }
  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function compileSchedule(ui: ScheduleUi): AutomationTrigger {
  if (ui.mode === "once") {
    return { type: "once", at: ui.at };
  }

  if (ui.mode === "interval") {
    if (ui.unit === "h") {
      if (!HOUR_INTERVALS.has(ui.every)) {
        throw new Error("invalid interval");
      }
      return { type: "cron", expr: `0 */${ui.every} * * *` };
    }
    if (ui.unit === "m") {
      if (!MINUTE_INTERVALS.has(ui.every)) {
        throw new Error("invalid interval");
      }
      return { type: "cron", expr: `*/${ui.every} * * * *` };
    }
    throw new Error("invalid interval");
  }

  const { hour, minute } = parseTime(ui.time);
  const dow =
    ui.cycle === "daily"
      ? "*"
      : ui.cycle === "weekday"
        ? "1-5"
        : ui.cycle;
  return { type: "cron", expr: `${minute} ${hour} * * ${dow}` };
}

export function decodeCron(
  expr: string,
): Extract<ScheduleUi, { mode: "cycle" | "interval" }> | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [minF, hourF, domF, monF, dowF] = parts;
  if (domF !== "*" || monF !== "*") {
    return null;
  }

  if (/^\*\/(\d+)$/.test(minF) && hourF === "*" && domF === "*" && monF === "*" && dowF === "*") {
    const every = Number(minF.slice(2));
    if (MINUTE_INTERVALS.has(every)) {
      return { mode: "interval", every, unit: "m" };
    }
    return null;
  }

  if (
    minF === "0" &&
    /^\*\/(\d+)$/.test(hourF) &&
    domF === "*" &&
    monF === "*" &&
    dowF === "*"
  ) {
    const every = Number(hourF.slice(2));
    if (HOUR_INTERVALS.has(every)) {
      return { mode: "interval", every, unit: "h" };
    }
    return null;
  }

  if (!/^\d+$/.test(minF) || !/^\d+$/.test(hourF)) {
    return null;
  }
  const minute = Number(minF);
  const hour = Number(hourF);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return null;
  }
  const time = formatTime(hour, minute);

  if (dowF === "*") {
    return { mode: "cycle", cycle: "daily", time };
  }
  if (dowF === "1-5") {
    return { mode: "cycle", cycle: "weekday", time };
  }
  if (/^[0-6]$/.test(dowF)) {
    return {
      mode: "cycle",
      cycle: dowF as "0" | "1" | "2" | "3" | "4" | "5" | "6",
      time,
    };
  }
  return null;
}

function expandRange(
  start: number,
  end: number,
  step: number,
  min: number,
  max: number,
): number[] {
  const values: number[] = [];
  for (let v = start; v <= end; v += step) {
    if (v >= min && v <= max) {
      values.push(v);
    }
  }
  return values;
}

function parseFieldPart(
  part: string,
  min: number,
  max: number,
  mapValue: (v: number) => number = (v) => v,
): Set<number> | null {
  if (part === "*") {
    return new Set(expandRange(min, max, 1, min, max).map(mapValue));
  }

  const stepMatch = /^(.+)\/(\d+)$/.exec(part);
  const base = stepMatch ? stepMatch[1] : part;
  const step = stepMatch ? Number(stepMatch[2]) : 1;
  if (!Number.isInteger(step) || step < 1) {
    return null;
  }

  const values = new Set<number>();

  for (const token of base.split(",")) {
    if (token === "*") {
      for (const v of expandRange(min, max, step, min, max)) {
        values.add(mapValue(v));
      }
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (a > b) {
        return null;
      }
      for (const v of expandRange(a, b, step, min, max)) {
        values.add(mapValue(v));
      }
      continue;
    }
    if (!/^\d+$/.test(token)) {
      return null;
    }
    const n = Number(token);
    if (n < min || n > max) {
      return null;
    }
    if ((n - min) % step === 0 || step === 1) {
      values.add(mapValue(n));
    }
  }

  return values;
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  const set = parseFieldPart(field, min, max);
  if (!set) {
    return false;
  }
  return set.has(value);
}

function dowMatches(field: string, jsDay: number): boolean {
  const normalized = jsDay === 0 ? [0, 7] : [jsDay];
  const set = parseFieldPart(field, 0, 7, (v) => (v === 7 ? 0 : v));
  if (!set) {
    return false;
  }
  return normalized.some((d) => set.has(d));
}

export function cronMatchesLocal(expr: string, at: Date): boolean {
  if (expr.includes("L") || expr.includes("#")) {
    return false;
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }
  const [minF, hourF, domF, monF, dowF] = parts;

  if (!fieldMatches(minF, at.getMinutes(), 0, 59)) {
    return false;
  }
  if (!fieldMatches(hourF, at.getHours(), 0, 23)) {
    return false;
  }
  if (!fieldMatches(monF, at.getMonth() + 1, 1, 12)) {
    return false;
  }

  const domIsStar = domF === "*";
  const dowIsStar = dowF === "*";
  if (domIsStar && dowIsStar) {
    return true;
  }

  const domMatch = domIsStar || fieldMatches(domF, at.getDate(), 1, 31);
  const dowMatch = dowIsStar || dowMatches(dowF, at.getDay());

  if (domIsStar) {
    return dowMatch;
  }
  if (dowIsStar) {
    return domMatch;
  }
  return domMatch || dowMatch;
}
