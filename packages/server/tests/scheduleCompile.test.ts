import { describe, it, expect } from "vitest";
import {
  compileSchedule,
  decodeCron,
  cronMatchesLocal,
} from "../src/services/scheduleCompile.js";

function localMondayAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  while (d.getDay() !== 1) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("scheduleCompile", () => {
  it("compileSchedule weekday 09:00 → cron expr", () => {
    expect(
      compileSchedule({ mode: "cycle", cycle: "weekday", time: "09:00" }),
    ).toEqual({ type: "cron", expr: "0 9 * * 1-5" });
  });

  it("cronMatchesLocal on weekday schedule", () => {
    const mondayNine = localMondayAt(9, 0);
    expect(cronMatchesLocal("0 9 * * 1-5", mondayNine)).toBe(true);
    const mondayNineOhOne = localMondayAt(9, 1);
    expect(cronMatchesLocal("0 9 * * 1-5", mondayNineOhOne)).toBe(false);
  });

  it("decodeCron returns null for unsolvable cron", () => {
    expect(decodeCron("0 9 1 * *")).toBeNull();
    expect(decodeCron("0 9 * * 1,3")).toBeNull();
  });

  it("compileSchedule daily and decode round-trip", () => {
    const ui = { mode: "cycle" as const, cycle: "daily" as const, time: "09:30" };
    const trigger = compileSchedule(ui);
    expect(trigger).toEqual({ type: "cron", expr: "30 9 * * *" });
    expect(decodeCron("30 9 * * *")).toEqual(ui);
  });

  it("compileSchedule interval hours and minutes", () => {
    expect(
      compileSchedule({ mode: "interval", every: 6, unit: "h" }),
    ).toEqual({ type: "cron", expr: "0 */6 * * *" });
    expect(
      compileSchedule({ mode: "interval", every: 15, unit: "m" }),
    ).toEqual({ type: "cron", expr: "*/15 * * * *" });
    expect(decodeCron("0 */6 * * *")).toEqual({
      mode: "interval",
      every: 6,
      unit: "h",
    });
    expect(decodeCron("*/15 * * * *")).toEqual({
      mode: "interval",
      every: 15,
      unit: "m",
    });
  });

  it("rejects invalid interval", () => {
    expect(() =>
      compileSchedule({ mode: "interval", every: 7, unit: "h" }),
    ).toThrow();
  });

  it("compileSchedule once", () => {
    expect(compileSchedule({ mode: "once", at: 1_700_000_000_000 })).toEqual({
      type: "once",
      at: 1_700_000_000_000,
    });
  });
});
