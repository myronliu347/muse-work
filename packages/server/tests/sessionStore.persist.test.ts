import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore } from "../src/sessionStore.js";
import { getSessionsConfigPath } from "@muse-work/provider";

describe("sessionStore persistence", () => {
  let home: string;
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("writes sessions.json and reloads activeSessionId + fields", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store1 = createSessionStore({ home });
    const s = store1.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
    });
    store1.select(s.id);
    store1.update(s.id, { title: "hello", pinned: true });

    const file = JSON.parse(
      fs.readFileSync(getSessionsConfigPath(home), "utf8"),
    );
    expect(file.version).toBe(1);
    expect(file.activeSessionId).toBe(s.id);
    expect(file.sessions[0].title).toBe("hello");
    expect(file.sessions[0].pinned).toBe(true);
    expect(file.sessions[0].model).toBe("deepseek-v4-flash");
    expect(file.sessions[0].status).toBeUndefined();

    const store2 = createSessionStore({ home });
    expect(store2.getActiveSessionId()).toBe(s.id);
    expect(store2.get(s.id)?.title).toBe("hello");
    expect(store2.listGrouped().pinned[0].id).toBe(s.id);
  });

  it("listGrouped hides sessions that never received a user message", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store = createSessionStore({ home });
    const draft = store.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
    });
    store.select(draft.id);
    expect(store.list()).toHaveLength(1);
    expect(store.listGrouped()).toEqual({
      pinned: [],
      recent: [],
      activeSessionId: undefined,
    });

    store.update(draft.id, { lastActiveAt: draft.createdAt + 1, title: "hi" });
    const grouped = store.listGrouped();
    expect(grouped.recent).toHaveLength(1);
    expect(grouped.recent[0]?.id).toBe(draft.id);
    expect(grouped.activeSessionId).toBe(draft.id);
  });
});
