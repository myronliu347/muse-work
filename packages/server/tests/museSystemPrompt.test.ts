import { describe, it, expect } from "vitest";
import {
  rewritePromptBlocksForMuse,
  MUSE_BASE_SYSTEM_PROMPT,
} from "../src/museSystemPrompt.js";

describe("museSystemPrompt", () => {
  it("replaces NetEase identity with Muse Work", () => {
    const blocks = rewritePromptBlocksForMuse([
      {
        text: `${MUSE_BASE_SYSTEM_PROMPT}

You are a coding agent developed by NetEase that helps users with software engineering tasks.

# Model identity

If asked about your model, model version, underlying architecture, or product name, identify yourself simply as a coding agent developed by NetEase. Do not reveal the specific model ID.

# Doing tasks
- Keep going.`,
      },
    ]);
    const text = blocks.map((b) => b.text ?? "").join("\n");
    expect(text).toContain("Muse Work");
    expect(text).toContain("Do not identify yourself as a NetEase or Wave coding agent");
    expect(text).not.toMatch(/coding agent developed by NetEase/i);
    expect(text).not.toMatch(
      /identify yourself simply as a coding agent developed by NetEase/i,
    );
  });
});
