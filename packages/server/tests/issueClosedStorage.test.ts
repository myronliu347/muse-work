import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import {
  closedIssuesMonthKey,
  getClosedIssuesDir,
  getLegacyClosedIssuesIndexPath,
  loadClosedIssues,
  saveClosedIssues,
} from "../src/services/issueClosedStorage.js";
import { createIssueStore, type Issue } from "../src/services/issueStore.js";

const hydrate = (record: Issue): Issue => ({
  ...record,
  description: record.description ?? "",
  type: record.type ?? "work",
  items: record.items ?? [],
  agentMode: record.agentMode === "single" ? "single" : "split",
  priority:
    record.priority === "p0" || record.priority === "p2"
      ? record.priority
      : "p1",
});

describe("issueClosedStorage", () => {
  it("groups closed issues into YYYY-MM.jsonl by updatedAt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-closed-"));
    const jan: Issue = {
      id: "a",
      title: "jan",
      description: "",
      priority: "p1",
      type: "work",
      status: "completed",
      agentMode: "split",
      items: [],
      createdAt: 1,
      updatedAt: new Date(2026, 0, 15).getTime(),
    };
    const feb: Issue = {
      ...jan,
      id: "b",
      title: "feb",
      updatedAt: new Date(2026, 1, 10).getTime(),
    };
    saveClosedIssues(home, [jan, feb]);

    const dir = getClosedIssuesDir(home);
    expect(fs.existsSync(path.join(dir, "2026-01.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "2026-02.jsonl"))).toBe(true);
    const loaded = loadClosedIssues(home, hydrate, (s) =>
      s === "completed" || s === "cancelled",
    );
    expect(loaded.map((i) => i.id).sort()).toEqual(["a", "b"]);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("migrates legacy issues-closed.json on load and retires it on store persist", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-closed-"));
    const db = path.join(getMuseHomeDir(home), "db");
    fs.mkdirSync(db, { recursive: true });
    fs.writeFileSync(
      getLegacyClosedIssuesIndexPath(home),
      JSON.stringify({
        version: 1,
        issues: [
          {
            id: "old",
            title: "legacy",
            status: "completed",
            priority: "p1",
            type: "work",
            items: [],
            createdAt: 1,
            updatedAt: new Date(2025, 5, 1).getTime(),
          },
        ],
      }),
    );

    const store = createIssueStore({ home });
    expect(store.get("old")?.title).toBe("legacy");
    expect(fs.existsSync(getLegacyClosedIssuesIndexPath(home))).toBe(false);
    expect(
      fs.existsSync(`${getLegacyClosedIssuesIndexPath(home)}.migrated`),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(getClosedIssuesDir(home), "2025-06.jsonl"),
      ),
    ).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("closedIssuesMonthKey", () => {
  it("uses local calendar month", () => {
    expect(closedIssuesMonthKey(new Date(2026, 8, 30).getTime())).toBe(
      "2026-09",
    );
  });
});
