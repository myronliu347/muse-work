import { describe, expect, it } from "vitest";
import { extendUsageWithCacheMetrics } from "../../src/utils/cacheControlUtils.js";
import type { CompletionUsage } from "openai/resources";

function usage(
  details: Record<string, unknown>,
): CompletionUsage {
  return {
    prompt_tokens: 10,
    completion_tokens: 2,
    total_tokens: 12,
    prompt_tokens_details: details,
  } as CompletionUsage;
}

describe("extendUsageWithCacheMetrics cache writes", () => {
  it("reads the flat gateway total", () => {
    const result = extendUsageWithCacheMetrics(
      usage({ cache_creation_input_tokens: 40 }),
    );
    expect(result.cache_creation_input_tokens).toBe(40);
  });

  it("falls back to Anthropic's 5m bucket when the flat total is absent", () => {
    const result = extendUsageWithCacheMetrics(
      usage({ cache_creation: { ephemeral_5m_input_tokens: 70 } }),
    );
    expect(result.cache_creation_input_tokens).toBe(70);
  });

  it("reads GPT cache_write_tokens and does not add it to another shape", () => {
    const onlyWrite = extendUsageWithCacheMetrics(
      usage({ cache_write_tokens: 15009 }),
    );
    expect(onlyWrite.cache_creation_input_tokens).toBe(15009);

    const both = extendUsageWithCacheMetrics(
      usage({
        cache_creation_input_tokens: 10,
        cache_write_tokens: 15009,
      }),
    );
    expect(both.cache_creation_input_tokens).toBe(10);
  });
});
