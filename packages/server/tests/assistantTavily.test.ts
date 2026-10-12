import { describe, expect, it } from "vitest";
import { createAssistantTools } from "../src/services/assistant/tools.js";

function toolsFor(tavily: {
  apiKey?: string;
  fetch?: typeof fetch;
}) {
  return createAssistantTools({
    home: "/tmp",
    issues: {} as never,
    sessions: {} as never,
    runner: {} as never,
    automations: {} as never,
    log: {} as never,
    hub: {} as never,
    tavily,
  });
}

function tool(name: string, tavily: { apiKey?: string; fetch?: typeof fetch }) {
  const found = toolsFor(tavily).find((entry) => entry.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

const context = { workdir: "/tmp", taskManager: {} as never };

describe("assistant tavily tools", () => {
  it("WebSearch fails closed when the key is missing", async () => {
    const result = await tool("WebSearch", { apiKey: "" }).execute(
      { query: "tavily" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("未配置 TAVILY_API_KEY");
  });

  it("WebSearch posts a basic query and returns the answer plus sources", async () => {
    const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({
          answer: "Tavily 是搜索接口",
          results: [
            {
              title: "Docs",
              url: "https://docs.tavily.com",
              content: "x".repeat(2000),
              published_date: "2026-10-01",
            },
          ],
        }),
        { status: 200 },
      );
    };
    const result = await tool("WebSearch", {
      apiKey: "tvly-test",
      fetch: fetchImpl,
    }).execute({ query: "什么是 tavily", topic: "news", maxResults: 3 }, context);
    expect(result.success).toBe(true);
    expect(calls[0]?.url).toBe("https://api.tavily.com/search");
    expect(calls[0]?.auth).toBe("Bearer tvly-test");
    expect(calls[0]?.body).toMatchObject({
      query: "什么是 tavily",
      topic: "news",
      max_results: 3,
      search_depth: "basic",
      include_answer: "basic",
    });
    const body = JSON.parse(result.content) as {
      answer: string;
      results: Array<{ content: string; publishedDate?: string }>;
    };
    expect(body.answer).toBe("Tavily 是搜索接口");
    expect(body.results[0]?.publishedDate).toBe("2026-10-01");
    expect([...body.results[0]!.content].length).toBeLessThan(2000);
  });
});
