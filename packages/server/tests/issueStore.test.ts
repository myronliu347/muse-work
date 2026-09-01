import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
});
