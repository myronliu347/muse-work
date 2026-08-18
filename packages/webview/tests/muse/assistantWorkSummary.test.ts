import { describe, expect, it } from "vitest";
import type { Message } from "wave-agent-sdk";
import {
  estimateAssistantWorkMs,
  formatWorkedDuration,
  shouldCollapseAssistantGroup,
} from "../../src/components/message/AssistantWorkSummary";

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

describe("formatWorkedDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatWorkedDuration(45_000)).toBe("45s");
  });

  it("formats minutes with trailing seconds", () => {
    expect(formatWorkedDuration(5 * 60_000 + 3_000)).toBe("5m 3s");
  });

  it("formats whole minutes without seconds", () => {
    expect(formatWorkedDuration(5 * 60_000)).toBe("5m");
  });

  it("summarizes hour-long durations with minutes and seconds", () => {
    expect(formatWorkedDuration(90 * 60_000 + 5_000)).toBe("1h 30m 5s");
  });

  it("formats hours with minutes but no seconds", () => {
    expect(formatWorkedDuration(3_600_000 + 30 * 60_000)).toBe("1h 30m");
  });

  it("formats whole hours without minutes", () => {
    expect(formatWorkedDuration(2 * 3_600_000)).toBe("2h");
  });

  it("clamps negative input to zero", () => {
    expect(formatWorkedDuration(-1_000)).toBe("0s");
  });
});
