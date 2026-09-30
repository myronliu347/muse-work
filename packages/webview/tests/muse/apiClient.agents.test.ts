import { describe, expect, it, vi } from "vitest";
import { MuseApiClient } from "../../src/muse/apiClient";

describe("MuseApiClient scenario models", () => {
  it("getScenarioModels GETs /scenarios/models", async () => {
    const fetches: string[] = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (input, init) => {
        fetches.push(`${init?.method ?? "GET"} ${input}`);
        return new Response(
          JSON.stringify({
            models: {
              session: "deepseek-v4-flash",
              popo: "deepseek-v4-flash",
              "issue-plan": "deepseek-v4-flash",
              "issue-exec": "deepseek-v4-flash",
            },
          }),
          { status: 200 },
        );
      },
    });
    const body = await client.getScenarioModels();
    expect(fetches[0]).toBe("GET http://127.0.0.1:9/scenarios/models");
    expect(body.models.session).toBe("deepseek-v4-flash");
  });

  it("putScenarioModels PUTs /scenarios/models", async () => {
    const fetches: Array<{ url: string; body: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (input, init) => {
        fetches.push({
          url: String(input),
          body: String(init?.body ?? ""),
        });
        return new Response(
          JSON.stringify({
            models: {
              session: "m2",
              popo: "deepseek-v4-flash",
              "issue-plan": "deepseek-v4-flash",
              "issue-exec": "deepseek-v4-flash",
            },
          }),
          { status: 200 },
        );
      },
    });
    await client.putScenarioModels({
      version: 1,
      models: { session: "m2" },
    });
    expect(fetches[0]?.url).toContain("/scenarios/models");
    expect(fetches[0]?.body).toContain('"session":"m2"');
  });
});
