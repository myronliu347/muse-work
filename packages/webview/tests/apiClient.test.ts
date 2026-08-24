import { describe, it, expect } from "vitest";
import { MuseApiClient } from "../src/muse/apiClient.js";

describe("MuseApiClient", () => {
  it("setActive posts provider and model", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method} ${url}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    await client.setActive("codemaker", "deepseek-v4-pro");
    expect(fetches[0]).toContain("/providers/active");
    expect(fetches[0]).toMatch(/^POST /);
  });

  it("listProviders GETs /providers", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            providers: [],
            active: { providerId: "codemaker", modelId: "m1" },
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.listProviders();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/providers");
    expect(body.active.providerId).toBe("codemaker");
  });

  it("login posts /auth/login", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method} ${url}`);
        return new Response(JSON.stringify({ authUrl: "https://example/auth" }), {
          status: 200,
        });
      },
    });
    const start = await client.login();
    expect(fetches[0]).toContain("/auth/login");
    expect(start).toEqual({ authUrl: "https://example/auth" });
  });

  it("sendMessage posts content to session messages", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      },
    });
    await client.sendMessage("sess-1", "hello");
    expect(bodies[0]).toContain("/sessions/sess-1/messages");
    expect(bodies[0]).toContain('"content":"hello"');
  });

  it("respondPermission posts decision", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    await client.respondPermission("sess-1", "perm-9", "allow");
    expect(bodies[0]).toContain("/sessions/sess-1/permissions/perm-9");
    expect(bodies[0]).toContain('"decision":"allow"');
  });

  it("getSettings GETs /settings and updateSettings PATCHes it", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({
          method: init?.method ?? "GET",
          url,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response(
          JSON.stringify({
            version: 1,
            plugins: { superpowers: false, mattpocock: true },
          }),
          { status: 200 },
        );
      },
    });
    await client.getSettings();
    expect(fetches[0]).toEqual({
      method: "GET",
      url: "http://127.0.0.1:9/settings",
      body: undefined,
    });
    await client.updateSettings({ plugins: { superpowers: false } });
    expect(fetches[1]?.method).toBe("PATCH");
    expect(fetches[1]?.url).toBe("http://127.0.0.1:9/settings");
    expect(JSON.parse(fetches[1]?.body ?? "{}")).toEqual({
      plugins: { superpowers: false },
    });
  });
});

describe("MuseApiClient todo/task", () => {
  it("listTodos GETs /todos", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            todos: [
              { id: "t1", title: "a", priority: "p1", source: "session", status: "pending" },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.listTodos();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/todos");
    expect(body.todos[0].priority).toBe("p1");
  });

  it("createTodo POSTs /todos with body", async () => {
    const fetches: Array<{ method?: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url, body: init?.body as string });
        return new Response(JSON.stringify({ todo: { id: "t9" } }), { status: 201 });
      },
    });
    await client.createTodo({
      title: "x",
      source: "session",
      priority: "p0",
      tags: ["urgent", "前端"],
    });
    expect(fetches[0].method).toBe("POST");
    expect(fetches[0].url).toBe("http://127.0.0.1:9/todos");
    expect(JSON.parse(fetches[0].body ?? "{}")).toEqual({
      title: "x",
      source: "session",
      priority: "p0",
      tags: ["urgent", "前端"],
    });
  });

  it("updateTodo PATCHes /todos/:id with tags", async () => {
    const fetches: Array<{ method?: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url, body: init?.body as string });
        return new Response(JSON.stringify({ todo: { id: "t1" } }), { status: 200 });
      },
    });
    await client.updateTodo("t1", { title: "y", tags: ["后端"] });
    expect(fetches[0].method).toBe("PATCH");
    expect(fetches[0].url).toBe("http://127.0.0.1:9/todos/t1");
    expect(JSON.parse(fetches[0].body ?? "{}")).toEqual({
      title: "y",
      tags: ["后端"],
    });
  });

  it("listTasks GETs /todos/:id/tasks", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
      },
    });
    await client.listTasks("t1");
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/todos/t1/tasks");
  });

  it("addComment POSTs /tasks/:id/comments", async () => {
    const fetches: Array<{ method?: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url, body: init?.body as string });
        return new Response(JSON.stringify({ comment: { id: "c1" } }), { status: 201 });
      },
    });
    await client.addComment("task1", {
      author: "user",
      kind: "note",
      content: "再审一次",
    });
    expect(fetches[0].method).toBe("POST");
    expect(fetches[0].url).toBe("http://127.0.0.1:9/tasks/task1/comments");
    expect(JSON.parse(fetches[0].body ?? "{}")).toEqual({
      author: "user",
      kind: "note",
      content: "再审一次",
    });
  });

  it("listRuns GETs /tasks/:id/runs", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      },
    });
    await client.listRuns("task1");
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/tasks/task1/runs");
  });

  it("updateRunStatus PATCHes /runs/:id", async () => {
    const fetches: Array<{ method?: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url, body: init?.body as string });
        return new Response(JSON.stringify({ run: { id: "r1", status: "running" } }), {
          status: 200,
        });
      },
    });
    await client.updateRunStatus("r1", "running");
    expect(fetches[0].method).toBe("PATCH");
    expect(fetches[0].url).toBe("http://127.0.0.1:9/runs/r1");
    expect(JSON.parse(fetches[0].body ?? "{}")).toEqual({ status: "running" });
  });

  it("enqueueTask POSTs /tasks/:id/enqueue", async () => {
    const fetches: Array<{ method?: string; url: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    await client.enqueueTask("task1");
    expect(fetches[0]).toEqual({ method: "POST", url: "http://127.0.0.1:9/tasks/task1/enqueue" });
  });

  it("cancelTask POSTs /tasks/:id/cancel", async () => {
    const fetches: Array<{ method?: string; url: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    await client.cancelTask("task1");
    expect(fetches[0]).toEqual({ method: "POST", url: "http://127.0.0.1:9/tasks/task1/cancel" });
  });

  it("openPlanningSession POSTs /todos/:id/planning-session", async () => {
    const fetches: Array<{ method?: string; url: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url });
        return new Response(JSON.stringify({ sessionId: "s1", workdir: "/p" }), {
          status: 200,
        });
      },
    });
    const res = await client.openPlanningSession("t1");
    expect(fetches[0]).toEqual({
      method: "POST",
      url: "http://127.0.0.1:9/todos/t1/planning-session",
    });
    expect(res.sessionId).toBe("s1");
  });
});
