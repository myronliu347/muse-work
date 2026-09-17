import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAutomationStore } from "../src/services/automationStore.js";

describe("automationStore", () => {
  it("persists create/disable/enable and prunes runs to 100", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-auto-"));
    const store = createAutomationStore({ home });
    const a = store.create({
      name: "巡检",
      prompt: "查 changelog",
      workdir: "/tmp/p",
      triggers: [{ type: "cron", expr: "0 9 * * 1-5" }],
      enabled: true,
    });
    expect(a.enabled).toBe(true);
    expect(store.setEnabled(a.id, false)?.enabled).toBe(false);
    expect(store.setEnabled(a.id, false)?.enabled).toBe(false); // idempotent
    for (let i = 0; i < 101; i++) {
      store.addRun({
        id: `r${i}`,
        automationId: a.id,
        status: "skipped",
        trigger: { type: "cron", firedAt: i },
        skipReason: "rule_running",
        startedAt: i,
      });
    }
    expect(store.listRuns(a.id)).toHaveLength(100);
    const store2 = createAutomationStore({ home });
    expect(store2.get(a.id)?.enabled).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
