import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore } from "../src/services/sessionStore.js";
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
    expect(file.sessions[0].status).toBe("idle");

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

  it("reloads a persisted running session as idle and marks it interrupted", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store1 = createSessionStore({ home });
    const s = store1.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
    });
    store1.update(s.id, { lastActiveAt: s.createdAt + 1, title: "mid-turn" });
    store1.updateStatus(s.id, "running");

    const file = JSON.parse(
      fs.readFileSync(getSessionsConfigPath(home), "utf8"),
    ) as { sessions: Array<{ status?: string }> };
    expect(file.sessions[0]?.status).toBe("running");

    const store2 = createSessionStore({ home });
    expect(store2.get(s.id)?.status).toBe("idle");
    expect(store2.get(s.id)?.interrupted).toBe(true);
    expect(store2.listGrouped().recent[0]?.interrupted).toBe(true);

    const reloaded = JSON.parse(
      fs.readFileSync(getSessionsConfigPath(home), "utf8"),
    ) as { sessions: Array<{ status?: string }> };
    expect(reloaded.sessions[0]?.status).toBe("idle");
  });

  it("listGrouped excludes automation origin sessions", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store = createSessionStore({ home });
    const hidden = store.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
      origin: "automation",
      title: "自动化 · 巡检",
    });
    const user = store.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
      title: "日常",
    });
    store.update(user.id, { lastActiveAt: user.createdAt + 1 });

    expect(store.get(hidden.id)?.origin).toBe("automation");
    expect(store.create({ workdir: "/tmp/proj", model: "m1" }).origin).toBe(
      "user",
    );
    expect(store.listGrouped().recent.map((s) => s.id)).toEqual([user.id]);
  });

  it("applies the recent cap after excluding issue sessions", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store = createSessionStore({ home });
    const excluded = new Set<string>();
    // A closed-issue backlog must not eat the 50 recent slots: issue sessions
    // are shown in their issue groups, not in 工作空间.
    for (let i = 0; i < 5; i += 1) {
      const issueSession = store.create({
        workdir: "/tmp/issue",
        model: "m1",
        title: `issue ${i}`,
      });
      store.update(issueSession.id, { lastActiveAt: 10_000 + i });
      excluded.add(issueSession.id);
    }
    for (let i = 0; i < 52; i += 1) {
      const normal = store.create({
        workdir: "/tmp/proj",
        model: "m1",
        title: `normal ${i}`,
      });
      store.update(normal.id, { lastActiveAt: 20_000 + i });
    }

    const grouped = store.listGrouped({ excludeSessionIds: excluded });
    expect(grouped.recent).toHaveLength(50);
    expect(grouped.recent.some((s) => excluded.has(s.id))).toBe(false);
    expect(grouped.recent[0]?.title).toBe("normal 51");
    expect(grouped.recent.at(-1)?.title).toBe("normal 2");

    // An issue session still restores even though it is not listed as recent.
    const issueOnly = [...excluded][0];
    store.select(issueOnly);
    expect(
      store.listGrouped({ excludeSessionIds: excluded }).activeSessionId,
    ).toBe(issueOnly);
  });

  it("reads leftover waveSessionId and rewrites museSessionId", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store1 = createSessionStore({ home });
    const s = store1.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
    });
    const configPath = getSessionsConfigPath(home);
    const file = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      sessions: Array<{ museSessionId?: string; waveSessionId?: string }>;
    };
    file.sessions[0].waveSessionId = "legacy-sdk-id";
    delete file.sessions[0].museSessionId;
    fs.writeFileSync(configPath, `${JSON.stringify(file, null, 2)}\n`);

    const store2 = createSessionStore({ home });
    expect(store2.get(s.id)?.museSessionId).toBe("legacy-sdk-id");
    const rewritten = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      sessions: Array<{ museSessionId?: string; waveSessionId?: string }>;
    };
    expect(rewritten.sessions[0]?.museSessionId).toBe("legacy-sdk-id");
    expect(rewritten.sessions[0]?.waveSessionId).toBeUndefined();
  });
});
