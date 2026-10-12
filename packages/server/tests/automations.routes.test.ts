import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("automations HTTP", () => {
  let server: Server | undefined;
  let home: string | undefined;
  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("create draft, reject enable until complete, disable is idempotent", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/automations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(created.status).toBe(201);
    const { automation } = await created.json();
    expect(automation.enabled).toBe(false);
    const en = await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" });
    expect(en.status).toBe(400);
    await fetch(`${app.baseUrl}/automations/${automation.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "巡检", prompt: "x", workdir: app.home,
        schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
      }),
    });
    expect((await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" })).status).toBe(200);
  });

  it("remind enables with a hint and a trigger, without a prompt", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "站会",
        mode: "remind",
        assistantHint: "提醒用户开站会",
        enabled: true,
        schedule: { mode: "cycle", cycle: "weekday", time: "09:30" },
      }),
    });
    expect(created.status).toBe(201);
    const { automation } = await created.json();
    expect(automation.mode).toBe("remind");
    expect(automation.assistantHint).toBe("提醒用户开站会");
    expect(automation.enabled).toBe(true);
    expect(automation.prompt).toBe("");
  });

  it("enable returns incomplete until prompt, workdir, and triggers exist", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    const en = await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, {
      method: "POST",
    });
    expect(en.status).toBe(400);
    expect(await en.json()).toEqual({ error: "incomplete" });
  });

  it("disable is idempotent and returns the rule", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "巡检",
        prompt: "x",
        workdir: app.home,
        schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
      }),
    }).then((r) => r.json());
    await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" });
    const first = await fetch(`${app.baseUrl}/automations/${automation.id}/disable`, {
      method: "POST",
    });
    expect(first.status).toBe(200);
    expect((await first.json()).automation.enabled).toBe(false);
    const second = await fetch(`${app.baseUrl}/automations/${automation.id}/disable`, {
      method: "POST",
    });
    expect(second.status).toBe(200);
    expect((await second.json()).automation.enabled).toBe(false);
  });

  it("PATCH that would leave an enabled automation incomplete returns 400 incomplete", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "巡检",
        prompt: "x",
        workdir: app.home,
        schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
      }),
    }).then((r) => r.json());
    expect(
      (await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" })).status,
    ).toBe(200);
    const patch = await fetch(`${app.baseUrl}/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    expect(patch.status).toBe(400);
    expect(await patch.json()).toEqual({ error: "incomplete" });
    const still = await fetch(`${app.baseUrl}/automations/${automation.id}`).then((r) => r.json());
    expect(still.automation.prompt).toBe("x");
    expect(still.automation.enabled).toBe(true);
  });

  it("rejects invalid issue trigger events, priority, and tags", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    const id = created.automation.id;
    const badEvent = await fetch(`${app.baseUrl}/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggers: [{ type: "issue", events: ["opened"] }],
      }),
    });
    expect(badEvent.status).toBe(400);
    const badPriority = await fetch(`${app.baseUrl}/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggers: [{ type: "issue", events: ["created"], priority: "p9" }],
      }),
    });
    expect(badPriority.status).toBe(400);
    const badTags = await fetch(`${app.baseUrl}/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggers: [{ type: "issue", events: ["created"], tags: "auth" }],
      }),
    });
    expect(badTags.status).toBe(400);
    const ok = await fetch(`${app.baseUrl}/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggers: [{ type: "issue", events: ["created", "review"], priority: "p1", tags: ["auth"] }],
      }),
    });
    expect(ok.status).toBe(200);
  });

  it("rejects illegal interval every: 7, unit: h on PATCH", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    const patch = await fetch(`${app.baseUrl}/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schedule: { mode: "interval", every: 7, unit: "h" },
      }),
    });
    expect(patch.status).toBe(400);
  });

  it("GET lists drafts, GET one, DELETE removes, and writes broadcast automation:changed", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const events: unknown[] = [];
    const original = app.ctx.hub.broadcastAll.bind(app.ctx.hub);
    app.ctx.hub.broadcastAll = (event) => {
      events.push(event);
      original(event);
    };
    const created = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(created.status).toBe(201);
    const { automation } = await created.json();
    const list = await fetch(`${app.baseUrl}/automations`).then((r) => r.json());
    expect(list.automations.map((a: { id: string }) => a.id)).toContain(automation.id);
    const one = await fetch(`${app.baseUrl}/automations/${automation.id}`);
    expect(one.status).toBe(200);
    const deleted = await fetch(`${app.baseUrl}/automations/${automation.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const missing = await fetch(`${app.baseUrl}/automations/${automation.id}`);
    expect(missing.status).toBe(404);
    expect(events.filter((e) => (e as { type: string }).type === "automation:changed").length).toBeGreaterThanOrEqual(2);
  });

  it("POST /automations/:id/run is 403 when disabled", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "巡检",
        prompt: "x",
        workdir: app.home,
        schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
      }),
    }).then((r) => r.json());
    const res = await fetch(`${app.baseUrl}/automations/${automation.id}/run`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "disabled" });
  });

  it("POST /automations/:id/run enqueues a manual run when enabled", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "巡检",
        prompt: "x",
        workdir: app.home,
        enabled: true,
        schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
      }),
    }).then((r) => r.json());
    const res = await fetch(`${app.baseUrl}/automations/${automation.id}/run`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.status).toBe("running");
    expect(body.run.trigger.type).toBe("manual");
    const runs = await fetch(
      `${app.baseUrl}/automations/${automation.id}/runs`,
    ).then((r) => r.json());
    expect(runs.runs).toHaveLength(1);
  });

  it("POST /automations/runs/:runId/stop aborts a running run", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { automation } = await fetch(`${app.baseUrl}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "巡检",
        prompt: "x",
        workdir: app.home,
        enabled: true,
        schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
      }),
    }).then((r) => r.json());
    const seeded = app.ctx.automationStore.addRun({
      id: crypto.randomUUID(),
      automationId: automation.id,
      status: "running",
      trigger: { type: "manual", firedAt: Date.now() },
      startedAt: Date.now(),
    });
    const res = await fetch(
      `${app.baseUrl}/automations/runs/${seeded.id}/stop`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.status).toBe("stopped");
    expect(body.run.endedAt).toEqual(expect.any(Number));
  });

  it("POST /automations/runs/:runId/stop returns 404 for unknown run", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(
      `${app.baseUrl}/automations/runs/missing-run/stop`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
