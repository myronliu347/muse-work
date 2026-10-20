import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIssueStore, type Issue } from "../src/services/issueStore.js";

type IssueEvent = {
  event: "created" | "review" | "completed" | "cancelled";
  issue: Issue;
};

describe("issueStore.subscribe", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes) {
      fs.rmSync(home, { recursive: true, force: true });
    }
    homes.length = 0;
  });

  function setup() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-sub-"));
    homes.push(home);
    const store = createIssueStore({ home });
    const events: IssueEvent[] = [];
    const unsubscribe = store.subscribe((e) => {
      events.push({ event: e.event, issue: e.issue });
    });
    return { store, events, unsubscribe };
  }

  function enterReview(store: ReturnType<typeof createIssueStore>, title = "t") {
    const issue = store.create({ title });
    store.setPlanning(issue.id, {
      planningSessionId: "p",
      workdir: "/tmp/a",
      worktreeEnabled: false,
    });
    store.markExecuting(issue.id);
    store.setItems(issue.id, [{ id: "i1", content: "a", status: "done" }]);
    return issue;
  }

  it("emits created, completed, and cancelled after successful changes", () => {
    const { store, events } = setup();
    const created = store.create({ title: "修登录" });
    expect(events.map((e) => e.event)).toEqual(["created"]);
    expect(events[0]?.issue.id).toBe(created.id);

    store.complete(created.id, "登录修好了");
    expect(events.map((e) => e.event)).toEqual(["created", "completed"]);

    const other = store.create({ title: "取消我" });
    store.cancel(other.id, "需求取消");
    expect(events.map((e) => e.event)).toEqual([
      "created",
      "completed",
      "created",
      "cancelled",
    ]);
  });

  it("emits review only the first time maybeEnterReview enters review", () => {
    const { store, events } = setup();
    const issue = enterReview(store);
    expect(store.get(issue.id)?.status).toBe("review");
    const reviews = events.filter((e) => e.event === "review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.issue.status).toBe("review");

    store.maybeEnterReview(issue.id);
    store.patchItem(issue.id, "i1", { status: "running" });
    store.maybeEnterReview(issue.id);
    expect(events.filter((e) => e.event === "review")).toHaveLength(1);
  });

  it("does not emit when complete or cancel is a no-op", () => {
    const { store, events } = setup();
    expect(store.complete("missing")).toBeUndefined();
    expect(store.cancel("missing")).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("unsubscribe stops further events", () => {
    const { store, events, unsubscribe } = setup();
    unsubscribe();
    store.create({ title: "静音" });
    expect(events).toEqual([]);
  });
});
