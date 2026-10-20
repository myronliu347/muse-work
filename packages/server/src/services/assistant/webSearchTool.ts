import type { ToolPlugin, ToolResult } from "@muse-work/agent";
import { tavilySearch, type TavilyOptions } from "./tavily.js";

const SEARCH_TOPICS = ["general", "news", "finance"] as const;
const TIME_RANGES = ["day", "week", "month", "year"] as const;

function fail(error: string): ToolResult {
  return { success: false, content: "", error };
}

function ok(value: unknown): ToolResult {
  return { success: true, content: JSON.stringify(value) };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function createWebSearchTool(deps: {
  home: string;
  tavily?: TavilyOptions;
}): ToolPlugin {
  return {
    name: "WebSearch",
    config: {
      type: "function",
      function: {
        name: "WebSearch",
        description:
          "用 Tavily 搜索网页。查事实、文档、新闻时用。返回简短答案和来源。要读某一页全文再用 WebFetch。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索词" },
            topic: {
              type: "string",
              enum: [...SEARCH_TOPICS],
              description: "general 综合，news 新闻，finance 财经。默认 general",
            },
            timeRange: {
              type: "string",
              enum: [...TIME_RANGES],
              description: "只要这段时间里的结果：day、week、month、year",
            },
            maxResults: { type: "number", description: "条数，1 到 10，默认 5" },
          },
          required: ["query"],
        },
      },
    },
    execute: async (args) => {
      const query = text(args.query);
      if (!query) return fail("需要 query");
      const topic = text(args.topic);
      if (topic && !SEARCH_TOPICS.includes(topic as (typeof SEARCH_TOPICS)[number])) {
        return fail("topic 只能是 general、news、finance");
      }
      const timeRange = text(args.timeRange);
      if (timeRange && !TIME_RANGES.includes(timeRange as (typeof TIME_RANGES)[number])) {
        return fail("timeRange 只能是 day、week、month、year");
      }
      const result = await tavilySearch(
        {
          query,
          search_depth: "basic",
          topic: topic || "general",
          max_results: clampInt(args.maxResults, 5, 1, 10),
          include_answer: "basic",
          ...(timeRange ? { time_range: timeRange } : {}),
        },
        { home: deps.home, ...deps.tavily },
      );
      return result.ok ? ok(result.value) : fail(result.error);
    },
  };
}
