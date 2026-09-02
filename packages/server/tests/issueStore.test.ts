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
    expect(store.getByPlanningSession("sess-plan")?.id).toBe(issue.id);
    expect(store.getByPlanningSession("other")).toBeUndefined();
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

  it("appendItems keeps done items; removePendingItem cannot drop executed", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({ title: "t" });
    store.setItems(issue.id, [
      { id: "i1", content: "已完成", status: "done" },
      { id: "i2", content: "未执行", status: "pending" },
    ]);
    store.appendItems(issue.id, [{ content: "新增" }]);
    const afterAdd = store.get(issue.id);
    expect(afterAdd?.items.map((i) => i.content)).toEqual([
      "已完成",
      "未执行",
      "新增",
    ]);
    expect(afterAdd?.items.find((i) => i.id === "i1")?.status).toBe("done");
    store.removePendingItem(issue.id, "i2");
    expect(store.get(issue.id)?.items.map((i) => i.content)).toEqual([
      "已完成",
      "新增",
    ]);
    expect(() => store.removePendingItem(issue.id, "i1")).toThrow(
      /pending/,
    );
    expect(store.get(issue.id)?.items.find((i) => i.id === "i1")).toBeTruthy();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("acceptItem marks pending done and cannot accept running", () => {
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
      { id: "i1", content: "调研", status: "pending" },
      { id: "i2", content: "改代码", status: "pending" },
    ]);
    store.acceptItem(issue.id, "i1");
    expect(store.get(issue.id)?.items.find((i) => i.id === "i1")?.status).toBe(
      "done",
    );
    expect(store.get(issue.id)?.status).toBe("executing");
    store.patchItem(issue.id, "i2", { status: "running" });
    expect(() => store.acceptItem(issue.id, "i2")).toThrow(/running/);
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

  it("complete and cancel persist in issues-closed.json, not issues.json", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const done = store.create({ title: "已完成" });
    const dropped = store.create({ title: "已取消" });
    store.create({ title: "进行中" });
    store.complete(done.id);
    store.cancel(dropped.id);

    const db = path.join(getMuseHomeDir(home), "db");
    const activeFile = JSON.parse(
      fs.readFileSync(path.join(db, "issues.json"), "utf-8"),
    ) as { issues: Array<{ title: string }> };
    const closedFile = JSON.parse(
      fs.readFileSync(path.join(db, "issues-closed.json"), "utf-8"),
    ) as { issues: Array<{ title: string; status: string }> };

    expect(activeFile.issues.map((issue) => issue.title)).toEqual(["进行中"]);
    expect(closedFile.issues.map((issue) => issue.title).sort()).toEqual([
      "已取消",
      "已完成",
    ]);
    expect(store.listActive().map((issue) => issue.title)).toEqual(["进行中"]);
    expect(store.listClosed().map((issue) => issue.status).sort()).toEqual([
      "cancelled",
      "completed",
    ]);
    expect(store.get(done.id)?.status).toBe("completed");

    const reloaded = createIssueStore({ home });
    expect(reloaded.listActive().map((issue) => issue.title)).toEqual([
      "进行中",
    ]);
    expect(reloaded.get(done.id)?.status).toBe("completed");
    expect(reloaded.get(dropped.id)?.status).toBe("cancelled");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("migrates leftover completed issues out of issues.json on load", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const dbDir = path.join(getMuseHomeDir(home), "db");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(
      path.join(dbDir, "issues.json"),
      JSON.stringify({
        version: 1,
        issues: [
          {
            id: "live-1",
            title: "还活着",
            status: "pending",
            priority: "p1",
            tags: [],
            items: [],
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: "old-done",
            title: "旧完成",
            status: "completed",
            priority: "p1",
            tags: [],
            items: [],
            createdAt: 1,
            updatedAt: 3,
          },
        ],
      }),
    );
    const store = createIssueStore({ home });
    expect(store.listActive().map((issue) => issue.id)).toEqual(["live-1"]);
    expect(store.get("old-done")?.status).toBe("completed");
    const activeFile = JSON.parse(
      fs.readFileSync(path.join(dbDir, "issues.json"), "utf-8"),
    ) as { issues: Array<{ id: string }> };
    const closedFile = JSON.parse(
      fs.readFileSync(path.join(dbDir, "issues-closed.json"), "utf-8"),
    ) as { issues: Array<{ id: string }> };
    expect(activeFile.issues.map((issue) => issue.id)).toEqual(["live-1"]);
    expect(closedFile.issues.map((issue) => issue.id)).toEqual(["old-done"]);
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
