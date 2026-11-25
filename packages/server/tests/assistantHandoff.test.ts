import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assistantHandoffConfigPath,
  buildHandoffMaterial,
  createAssistantHandoff,
  createAssistantHandoffScheduler,
  loadAssistantHandoffConfig,
  normalizeModelHandoff,
  saveAssistantHandoffConfig,
} from "../src/services/assistantHandoff.js";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";
import { createIssueProgressStore } from "../src/services/issueProgress.js";
import { createIssueStore } from "../src/services/issueStore.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-handoff-"));
  homes.push(home);
  return home;
}

function fakeSession(workdir: string) {
  return {
    id: "assistant-1",
    origin: "assistant" as const,
    workdir,
    status: "idle",
    lastActiveAt: 0,
  };
}

function harness(options?: {
  busy?: boolean;
  session?: ReturnType<typeof fakeSession>;
  askFails?: boolean;
  beginFails?: boolean;
}) {
  const home = tempHome();
  const workdir = path.join(home, "assistant-chat");
  fs.mkdirSync(workdir, { recursive: true });
  const issues = createIssueStore({ home });
  const issueProgress = createIssueProgressStore({ home });
  const assistantLog = createAssistantMessageLog({ home });
  const calls: string[] = [];
  const notes: string[] = [];
  const asks: string[] = [];
  const broadcasts: unknown[] = [];
  const written = `# 交接 · 2026-11-25 04:00\n\n给下一个自己：修复登录 500 已定位到 cookie 解析，明天补测试。\n周报还等用户看一眼提纲；旧 cookie 兼容性要不要保留，等用户拍板。`;
  const runner = {
    clear: async (id: string) => {
      calls.push(`clear:${id}`);
      return { ok: true as const };
    },
    appendSystemNote: async (id: string, content: string) => {
      calls.push(`note:${id}`);
      notes.push(content);
    },
    isCompacting: () => false,
    askBtw: async (_id: string, question: string) => {
      asks.push(question);
      if (options?.askFails) throw new Error("model unavailable");
      return written;
    },
  };
  const session = options?.session ?? fakeSession(workdir);
  const service = createAssistantHandoff({
    home,
    sessions: { list: () => [session] },
    runner,
    issues,
    issueProgress,
    assistantLog,
    hub: {
      broadcastAll: (event: unknown) => {
        broadcasts.push(event);
      },
    },
    isBusy: () => options?.busy === true,
    beginAssistantExclusive: () => {
      calls.push("begin");
      return options?.beginFails !== true;
    },
    endAssistantExclusive: () => {
      calls.push("end");
    },
    now: () => new Date(2026, 10, 25, 4, 0, 0),
  });
  return {
    home,
    workdir,
    issues,
    issueProgress,
    assistantLog,
    service,
    calls,
    notes,
    asks,
    broadcasts,
    written,
  };
}

describe("assistant handoff config", () => {
  it("defaults to enabled at 04:00", () => {
    const home = tempHome();
    const config = loadAssistantHandoffConfig(home);
    expect(config.enabled).toBe(true);
    expect(config.hour).toBe(4);
    expect(fs.existsSync(assistantHandoffConfigPath(home))).toBe(false);
  });

  it("persists enabled and hour", () => {
    const home = tempHome();
    saveAssistantHandoffConfig(home, {
      version: 1,
      enabled: false,
      hour: 22,
    });
    const config = loadAssistantHandoffConfig(home);
    expect(config.enabled).toBe(false);
    expect(config.hour).toBe(22);
  });

  it("rejects an out-of-range hour", () => {
    const { service } = harness();
    expect(() => service.update({ hour: 24 })).toThrow();
  });
});

describe("buildHandoffMarkdown", () => {
  it("writes the sections a fresh session needs", () => {
    const { issues, issueProgress } = harness();
    const issue = issues.create({ title: "修复登录 500", priority: "p0" });
    issueProgress.append(issue.id, {
      kind: "assistant",
      summary: "已定位到 cookie 解析",
      next: "补测试",
    });
    const latest = issueProgress.latest(issue.id);
    const markdown = buildHandoffMaterial({
      facts: [
        {
          issue,
          ...(latest ? { latest } : {}),
          updates: latest ? [latest] : [],
        },
      ],
      messages: [{ at: Date.now(), role: "assistant", message: "登录那个我补了测试" }],
    });
    expect(markdown).toContain("现在在跟");
    expect(markdown).toContain("修复登录 500");
    expect(markdown).toContain("补测试");
    expect(markdown).toContain("今天有动静");
    expect(markdown).toContain("明天先做");
  });
});

describe("normalizeModelHandoff", () => {
  it("strips a markdown code fence", () => {
    expect(normalizeModelHandoff("```markdown\n# 交接\n正文\n```")).toBe(
      "# 交接\n正文",
    );
  });

  it("drops empty and error responses", () => {
    expect(normalizeModelHandoff("")).toBe("");
    expect(normalizeModelHandoff("No response received")).toBe("");
    expect(normalizeModelHandoff("(The model tried to call Write)")).toBe("");
  });
});

describe("assistant handoff run", () => {
  it("writes handoff + journal, rotates context, and keeps the chat log", async () => {
    const h = harness();
    const issue = h.issues.create({ title: "修复登录 500", priority: "p0" });
    h.issueProgress.append(issue.id, {
      kind: "assistant",
      summary: "已定位到 cookie 解析",
      next: "补测试",
    });
    h.assistantLog.append("user", "登录那个看一下");
    h.assistantLog.append("assistant", "已经定位到 cookie 解析，下一步补测试");

    const result = await h.service.run("manual");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const handoff = fs.readFileSync(path.join(h.workdir, "HANDOFF.md"), "utf8");
    expect(handoff).toBe(h.written);
    expect(h.asks[0]).toContain("修复登录 500");
    expect(h.asks[0]).toContain("补测试");
    expect(h.asks[0]).toContain("不要调用 SendMessage");

    const journal = fs.readFileSync(
      path.join(h.workdir, "JOURNAL", "2026-11-25.md"),
      "utf8",
    );
    expect(journal).toBe(`${h.written}\n`);

    expect(h.calls[0]).toBe("begin");
    expect(h.calls).toContain("clear:assistant-1");
    expect(h.calls).toContain("note:assistant-1");
    expect(h.calls.at(-1)).toBe("end");
    expect(h.notes[0]).toContain("【收工交接】");
    expect(h.notes[0]).toContain("修复登录 500");
    expect(h.notes[0]).toContain(path.join(h.workdir, "HANDOFF.md"));

    // 用户可见的聊天记录不能被清掉，也不应该出现“已收工”通知。
    expect(h.assistantLog.page({ limit: 10 }).messages).toHaveLength(2);
    expect(h.assistantLog.page({ limit: 10 }).messages[0]?.message).toBe(
      "登录那个看一下",
    );
    expect(
      h.broadcasts.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: string }).type === "assistant:cleared",
      ),
    ).toBe(false);
    expect(
      h.broadcasts.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: string }).type === "assistant:chat",
      ),
    ).toBe(false);
    expect(
      h.broadcasts.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: string }).type === "assistant:handoff",
      ),
    ).toBe(true);

    const config = loadAssistantHandoffConfig(h.home);
    expect(config.lastRunAt).toBe(new Date(2026, 10, 25, 4, 0, 0).getTime());
  });

  it("does not touch the session while the assistant is busy", async () => {
    const h = harness({ busy: true });
    h.assistantLog.append("user", "你好");
    const result = await h.service.run("manual");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected busy");
    expect(result.busy).toBe(true);
    expect(h.calls).toEqual([]);
  });

  it("does not clear when the assistant fails to write the handoff", async () => {
    const h = harness({ askFails: true });
    h.assistantLog.append("user", "你好");
    const result = await h.service.run("manual");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("没有清空上下文");
    expect(h.calls).toEqual(["begin", "end"]);
    expect(fs.existsSync(path.join(h.workdir, "HANDOFF.md"))).toBe(false);
    expect(h.assistantLog.page({ limit: 10 }).messages).toHaveLength(1);
  });

  it("backs off if a turn starts just before the exclusive window", async () => {
    const h = harness({ beginFails: true });
    h.assistantLog.append("user", "你好");
    const result = await h.service.run("manual");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected busy");
    expect(result.busy).toBe(true);
    expect(h.calls).toEqual(["begin"]);
    expect(h.asks).toEqual([]);
  });

  it("skips a scheduled run when there is no activity", async () => {
    const h = harness();
    saveAssistantHandoffConfig(h.home, {
      version: 1,
      enabled: true,
      hour: 4,
      lastRunAt: new Date(2026, 10, 25, 4, 0, 0).getTime(),
    });
    const result = await h.service.run("schedule");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.skipped).toBe("no_activity");
    expect(h.calls).toEqual([]);
  });
});

describe("assistant handoff routes", () => {
  it("reads and updates the switch and reports a busy manual run", async () => {
    const { createHonoApp } = await import("../src/app.js");
    const state = {
      version: 1 as const,
      enabled: true,
      hour: 4,
      nextRunAt: Date.now() + 1000,
      working: false,
      handoffPath: "/tmp/HANDOFF.md",
      handoff: null,
    };
    const service = {
      getState: () => state,
      update: (patch: { enabled?: boolean; hour?: number }) => ({
        ...state,
        ...patch,
      }),
      run: async () => ({ ok: false as const, error: "busy", busy: true }),
    };
    const app = createHonoApp({
      assistantHandoff: service,
    } as unknown as import("../src/services/appContext.js").AppContext);

    const got = await app.request("/assistant/handoff");
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ enabled: true, hour: 4 });

    const bad = await app.request("/assistant/handoff", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hour: 24 }),
    });
    expect(bad.status).toBe(400);

    const off = await app.request("/assistant/handoff", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ enabled: false });

    const run = await app.request("/assistant/handoff/run", { method: "POST" });
    expect(run.status).toBe(409);
  });
});

describe("assistant handoff scheduler", () => {
  function schedulerHarness(options?: {
    hour?: number;
    enabled?: boolean;
    lastActiveAt?: number;
    now?: Date;
  }) {
    const calls: string[] = [];
    const service = {
      getConfig: () => ({
        version: 1 as const,
        enabled: options?.enabled ?? true,
        hour: options?.hour ?? 4,
      }),
      assistantSession: () => ({
        id: "assistant-1",
        origin: "assistant" as const,
        workdir: "/tmp/assistant-chat",
        status: "idle",
        lastActiveAt: options?.lastActiveAt ?? 0,
      }),
      markAttempt: () => {
        calls.push("mark");
      },
      run: async (trigger: string) => {
        calls.push(trigger);
        return { ok: true as const, handoff: "", handoffPath: "" };
      },
    };
    const scheduler = createAssistantHandoffScheduler({
      service: service as never,
      now: () => options?.now ?? new Date(2026, 10, 25, 4, 1, 0),
    });
    return { calls, scheduler };
  }

  it("runs once the configured hour is due and the assistant is idle", async () => {
    const h = schedulerHarness();
    await h.scheduler.tick();
    expect(h.calls).toEqual(["schedule"]);
  });

  it("does nothing before the hour or when disabled", async () => {
    const early = schedulerHarness({ now: new Date(2026, 10, 25, 3, 59, 0) });
    await early.scheduler.tick();
    expect(early.calls).toEqual([]);

    const off = schedulerHarness({ enabled: false });
    await off.scheduler.tick();
    expect(off.calls).toEqual([]);
  });

  it("skips the day if the assistant has already been active", async () => {
    const h = schedulerHarness({
      lastActiveAt: new Date(2026, 10, 25, 4, 0, 30).getTime(),
    });
    await h.scheduler.tick();
    expect(h.calls).toEqual(["mark"]);
  });
});
