import { describe, expect, it } from "vitest";
import type { Message } from "wave-agent-sdk";
import {
  estimateAssistantWorkMs,
  shouldCollapseAssistantGroup,
} from "../../src/components/AssistantWorkSummary";

function msg(
  id: string,
  blocks: Message["blocks"],
  timestamp = "2026-08-13T02:00:00.000Z",
): Message {
  return { id, role: "assistant", blocks, timestamp };
}

describe("shouldCollapseAssistantGroup", () => {
  it("is false for a single text reply", () => {
    expect(
      shouldCollapseAssistantGroup([
        msg("a", [{ type: "text", content: "hi", stage: "end" }]),
      ]),
    ).toBe(false);
  });

  it("is true when tools precede a final text block", () => {
    expect(
      shouldCollapseAssistantGroup([
        msg("a", [
          {
            type: "tool",
            name: "Bash",
            stage: "end",
            parameters: "{}",
          },
          { type: "text", content: "done", stage: "end" },
        ]),
      ]),
    ).toBe(true);
  });
});

describe("estimateAssistantWorkMs", () => {
  it("uses reasoning start/end when present", () => {
    const ms = estimateAssistantWorkMs([
      msg("a", [
        {
          type: "reasoning",
          content: "...",
          stage: "end",
          startTime: 1_000,
          endTime: 6_000,
        },
        { type: "text", content: "ok", stage: "end" },
      ]),
    ]);
    expect(ms).toBe(5_000);
  });
});
