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
    await client.setActive("hosted", "deepseek-v4-pro");
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
            active: { providerId: "hosted", modelId: "m1" },
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.listProviders();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/providers");
    expect(body.active.providerId).toBe("hosted");
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

});

describe("MuseApiClient issues", () => {
  it("listIssues GETs /issues", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            issues: [
              {
                id: "i1",
                title: "修登录",
                description: "",
                priority: "p1",
                type: "bug",
                status: "pending",
                items: [],
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.listIssues();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/issues");
    expect(body.issues[0]?.priority).toBe("p1");
  });

  it("createIssue POSTs /issues with body", async () => {
    const fetches: Array<{ method?: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({ method: init?.method, url, body: init?.body as string });
        return new Response(JSON.stringify({ issue: { id: "i9" } }), {
          status: 201,
        });
      },
    });
    await client.createIssue({
      title: "x",
      priority: "p0",
      type: "bug",
    });
    expect(fetches[0]?.method).toBe("POST");
    expect(fetches[0]?.url).toBe("http://127.0.0.1:9/issues");
    expect(JSON.parse(fetches[0]?.body ?? "{}")).toEqual({
      title: "x",
      priority: "p0",
      type: "bug",
    });
  });
});
