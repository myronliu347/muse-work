import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { createIssueStore } from "../src/services/issueStore.js";

describe("issueStore", () => {
  it("persists create and reloads tags/priority", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({
      title: "修登录",
      tags: [" Auth ", "auth", ""],
      priority: "p0",
    });
    expect(issue.status).toBe("pending");
    expect(issue.tags).toEqual(["auth"]);
    expect(issue.priority).toBe("p0");
    const reloaded = createIssueStore({ home });
    expect(reloaded.get(issue.id)?.title).toBe("修登录");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("hasPlanningSession is true only after setPlanning", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({ title: "t" });
    expect(store.hasPlanningSession("sess-plan")).toBe(false);
    store.setPlanning(issue.id, {
      planningSessionId: "sess-plan",
      workdir: "/tmp/a",
      worktreeEnabled: false,
    });
    expect(store.hasPlanningSession("sess-plan")).toBe(true);
    expect(store.hasPlanningSession("other")).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("setItems with all done while executing enters review", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({ title: "t" });
    store.setPlanning(issue.id, {
      planningSessionId: "p",
      workdir: "/tmp/a",
      worktreeEnabled: false,
    });
    store.markExecuting(issue.id);
    store.setItems(issue.id, [{ id: "i1", content: "a", status: "done" }]);
    expect(store.get(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("patchItem to last done while executing enters review", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({ title: "t" });
    store.setPlanning(issue.id, {
      planningSessionId: "p",
      workdir: "/tmp/a",
      worktreeEnabled: false,
    });
    store.markExecuting(issue.id);
    store.setItems(issue.id, [
      { id: "i1", content: "a", status: "done" },
      { id: "i2", content: "b", status: "pending" },
    ]);
    expect(store.get(issue.id)?.status).toBe("executing");
    store.patchItem(issue.id, "i2", { status: "done" });
    expect(store.get(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("maybeEnterReview stays review after items bounce", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({ title: "t" });
    store.setPlanning(issue.id, {
      planningSessionId: "p",
      workdir: "/tmp/a",
      worktreeEnabled: false,
    });
    store.markExecuting(issue.id);
    store.setItems(issue.id, [
      { id: "i1", content: "a", status: "done" },
    ]);
    expect(store.maybeEnterReview(issue.id)?.status).toBe("review");
    store.patchItem(issue.id, "i1", { status: "running" });
    expect(store.maybeEnterReview(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("complete rejects cancelled; cancel rejects completed", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const a = store.create({ title: "a" });
    store.cancel(a.id);
    expect(store.complete(a.id)).toBeUndefined();
    const b = store.create({ title: "b" });
    store.complete(b.id);
    expect(store.cancel(b.id)).toBeUndefined();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("listActive skips leftover todo-board issues with unknown status and no priority", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const dbDir = path.join(getMuseHomeDir(home), "db");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(
      path.join(dbDir, "issues.json"),
      JSON.stringify({
        version: 1,
        issues: [
          {
            id: "612263f6-aee5-4f5c-a395-f940f592e4ab",
            projectId: "3d39eb45-9faf-4f63-940e-0c8c033bf0fb",
            title: "测试任务看板功能",
            description: "用于测试任务看板功能的 issue",
            status: "reviewing",
            createdAt: 1,
            updatedAt: 2,
            workdir: "/tmp/exams",
          },
          {
            id: "be9807c0-58d5-4ad6-b1e1-9cf28d6d8ae2",
            title: "功能测试-已更新",
            status: "todo",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    const store = createIssueStore({ home });
    expect(store.listActive()).toEqual([]);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
