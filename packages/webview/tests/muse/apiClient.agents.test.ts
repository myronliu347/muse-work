import { describe, it, expect } from "vitest";
import { MuseApiClient } from "../../src/muse/apiClient.js";

const agent = {
  key: "default",
  name: "Muse",
  personality: "professional",
  systemPrompt: "",
  model: "deepseek-v4-flash",
  fastModel: "",
  tools: [],
  permission: [],
};

describe("MuseApiClient agent APIs", () => {
  it("getAgents GETs /agents", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({ version: 1, agents: [agent] }),
          { status: 200 },
        );
      },
    });
    const body = await client.getAgents();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/agents");
    expect(body.agents[0]?.key).toBe("default");
  });

  it("getAgentScenarios GETs /agents/scenarios", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            scenarios: {
              session: "default",
              popo: "popo",
              "issue-plan": "plan",
              "issue-exec": "execute",
            },
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.getAgentScenarios();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/agents/scenarios");
    expect(body.scenarios.popo).toBe("popo");
  });

  it("putAgents PUTs /agents with payload", async () => {
    const bodies: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        bodies.push(init?.body as string);
        return new Response(
          JSON.stringify({ version: 1, agents: [agent] }),
          { status: 200 },
        );
      },
    });
    await client.putAgents({
      version: 1,
      agents: { default: { name: "Muse" } },
    });
    expect(bodies[0]).toBe(
      JSON.stringify({ version: 1, agents: { default: { name: "Muse" } } }),
    );
  });

  it("putAgentScenarios PUTs /agents/scenarios", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(
          JSON.stringify({
            scenarios: {
              session: "default",
              popo: "popo",
              "issue-plan": "plan",
              "issue-exec": "execute",
            },
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.putAgentScenarios({
      version: 1,
      scenarios: { session: "default" },
    });
    expect(fetches[0]).toBe("PUT http://127.0.0.1:9/agents/scenarios");
    expect(body.scenarios.session).toBe("default");
  });
});
