import { describe, it, expect } from "vitest";
import { MuseApiClient } from "../../src/muse/apiClient.js";

const sampleSession = {
  id: "sess-1",
  workdir: "/tmp/proj",
  createdAt: 100,
  lastActiveAt: 200,
  status: "idle",
  title: "新对话",
  model: "deepseek-v4-pro",
  pinned: false,
};

describe("MuseApiClient session APIs", () => {
  it("listSessionsGrouped GETs /sessions?grouped=1", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            pinned: [],
            recent: [sampleSession],
            activeSessionId: "sess-1",
          }),
          { status: 200 },
        );
      },
    });

    const body = await client.listSessionsGrouped();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/sessions?grouped=1");
    expect(body.activeSessionId).toBe("sess-1");
    expect(body.recent[0]?.id).toBe("sess-1");
  });

  it("selectSession POSTs /sessions/:id/select", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({ session: sampleSession, clearedUnread: true }),
          { status: 200 },
        );
      },
    });

    const body = await client.selectSession("sess-1");
    expect(fetches[0]).toBe("POST http://127.0.0.1:9/sessions/sess-1/select");
    expect(body.session.id).toBe("sess-1");
  });

  it("patchSession PATCHes title/pinned/model", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(
          JSON.stringify({ ...sampleSession, pinned: true, title: "Hi" }),
          { status: 200 },
        );
      },
    });

    const session = await client.patchSession("sess-1", {
      pinned: true,
      title: "Hi",
      model: "m2",
    });
    expect(bodies[0]).toContain("PATCH http://127.0.0.1:9/sessions/sess-1");
    expect(bodies[0]).toContain('"pinned":true');
    expect(bodies[0]).toContain('"title":"Hi"');
    expect(bodies[0]).toContain('"model":"m2"');
    expect(session.pinned).toBe(true);
  });

  it("patchSession model does not call providers/active", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({ ...sampleSession, model: "m2" }),
          { status: 200 },
        );
      },
    });

    await client.patchSession("sess-1", { model: "m2" });
    expect(fetches).toEqual(["PATCH http://127.0.0.1:9/sessions/sess-1"]);
    expect(fetches.some((f) => f.includes("/providers/active"))).toBe(false);
  });

  it("deleteSession DELETEs /sessions/:id", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await client.deleteSession("sess-1");
    expect(fetches[0]).toBe("DELETE http://127.0.0.1:9/sessions/sess-1");
  });

  it("getMessages GETs /sessions/:id/messages", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            messages: [{ id: "m1", role: "user", blocks: [] }],
          }),
          { status: 200 },
        );
      },
    });

    const body = await client.getMessages("sess-1");
    expect(fetches[0]).toBe(
      "GET http://127.0.0.1:9/sessions/sess-1/messages",
    );
    expect(body.messages).toHaveLength(1);
  });

  it("createSession posts optional model", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(JSON.stringify(sampleSession), { status: 200 });
      },
    });

    await client.createSession("/tmp/proj", { model: "m2" });
    expect(bodies[0]).toContain("POST http://127.0.0.1:9/sessions");
    expect(bodies[0]).toContain('"workdir":"/tmp/proj"');
    expect(bodies[0]).toContain('"model":"m2"');
  });

  it("createSession posts optional permissionMode", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(JSON.stringify(sampleSession), { status: 200 });
      },
    });

    await client.createSession("/tmp/proj", {
      model: "m2",
      permissionMode: "bypassPermissions",
    });
    expect(bodies[0]).toContain("POST http://127.0.0.1:9/sessions");
    expect(bodies[0]).toContain('"permissionMode":"bypassPermissions"');
  });

  it("createSession posts optional agent", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(
          JSON.stringify({ ...sampleSession, agentName: "xiaomei" }),
          { status: 200 },
        );
      },
    });

    await client.createSession("/tmp/proj", {
      model: "m2",
      agent: "xiaomei",
    });
    expect(bodies[0]).toContain("POST http://127.0.0.1:9/sessions");
    expect(bodies[0]).toContain('"agent":"xiaomei"');
  });
});
