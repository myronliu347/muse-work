import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adoptRuleDraft,
  lintRuleContent,
  parseRuleCandidates,
  readRuleDrafts,
  ruleRootForWorkdir,
  writeRuleDrafts,
} from "../src/services/ruleDream.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("ruleDream", () => {
  it("parses rules and drafts a single occurrence with metadata", () => {
    const text = JSON.stringify({
      rules: [
        {
          name: "report-timing",
          description: "只在需要拍板时主动发消息。",
          text: "只有失败、卡住或需要用户拍板时才主动发消息。",
          evidence: [{ day: "2026-11-20" }],
          occurrenceDays: 1,
          explicit: false,
          confidence: 0.8,
        },
      ],
    });
    const candidates = parseRuleCandidates(text);
    expect(candidates).toHaveLength(1);
    const draftDir = tempDir("muse-rule-gate-");
    const drafts = writeRuleDrafts({
      draftDir,
      candidates,
      runId: "r1",
      day: "2026-11-24",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.occurrenceDays).toBe(1);
  });

  it("rejects duplicate AGENTS.md rules, secrets and long text", () => {
    expect(
      lintRuleContent({
        name: "x",
        text: "只有失败或需要拍板时才主动发消息。",
        description: "x",
        agentsMd: "## 汇报\n只有失败或需要拍板时才主动发消息。",
      }).ok,
    ).toBe(false);
    expect(
      lintRuleContent({
        name: "x",
        text: `sk-${"a".repeat(30)}`,
        description: "x",
      }).ok,
    ).toBe(false);
    expect(
      lintRuleContent({
        name: "x",
        text: "a".repeat(501),
        description: "x",
      }).ok,
    ).toBe(false);
  });

  it("normalizes rule create/update against existing rules", () => {
    const draftDir = tempDir("muse-rule-action-");
    const existing = [{ name: "report-timing", text: "old rule" }];
    const base = {
      name: "report-timing",
      description: "x",
      text: "new rule text",
      evidence: [],
      confidence: 0.8,
      occurrenceDays: 2,
    };
    const forced = writeRuleDrafts({
      draftDir,
      candidates: [{ ...base, action: "create" }],
      existingRules: existing,
      runId: "r1",
      day: "2026-11-24",
    });
    expect(forced[0]?.action).toBe("update");

    const missing = writeRuleDrafts({
      draftDir: tempDir("muse-rule-action2-"),
      candidates: [{ ...base, action: "update", name: "new-rule" }],
      existingRules: existing,
      runId: "r2",
      day: "2026-11-24",
    });
    expect(missing[0]?.action).toBe("create");
  });

  it("writes, reads and adopts a rule with backup", () => {
    const draftDir = tempDir("muse-rule-draft-");
    const workdir = tempDir("muse-rule-work-");
    const backupRoot = tempDir("muse-rule-backup-");
    const candidate = {
      name: "report-timing",
      description: "只在需要拍板时主动发消息。",
      text: "只有失败、卡住或需要用户拍板时才主动发消息。",
      evidence: [{ day: "2026-11-20" }],
      confidence: 0.8,
      occurrenceDays: 2,
    };
    expect(
      writeRuleDrafts({
        draftDir,
        candidates: [candidate],
        runId: "r1",
        day: "2026-11-24",
      }),
    ).toHaveLength(1);
    const drafts = readRuleDrafts(draftDir);
    expect(drafts[0]?.text).toBe(candidate.text);

    const first = adoptRuleDraft({
      draftDir,
      name: "report-timing",
      workdir,
      backupRoot,
    });
    expect(first.ok).toBe(true);
    const live = path.join(ruleRootForWorkdir(workdir), "auto-report-timing.md");
    expect(fs.readFileSync(live, "utf-8")).toContain(candidate.text);

    const updated = { ...candidate, text: "只在失败或需要拍板时发消息。" };
    writeRuleDrafts({
      draftDir,
      candidates: [updated],
      runId: "r2",
      day: "2026-11-25",
    });
    const second = adoptRuleDraft({
      draftDir,
      name: "report-timing",
      workdir,
      backupRoot,
    });
    expect(second.ok).toBe(true);
    expect(second.backupPath).toBeTruthy();
    expect(fs.readFileSync(second.backupPath!, "utf-8")).toContain(candidate.text);
  });
});
