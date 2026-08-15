import { describe, it, expect } from "vitest";
import {
  rewritePromptBlocksForMuse,
  buildMuseIdentityPrompt,
  MUSE_BASE_SYSTEM_PROMPT,
} from "../src/services/museSystemPrompt.js";

describe("museSystemPrompt", () => {
  it("replaces NetEase identity with Muse and injects selected model", () => {
    const blocks = rewritePromptBlocksForMuse(
      [
        {
          text: `${MUSE_BASE_SYSTEM_PROMPT}

You are a coding agent developed by NetEase that helps users with software engineering tasks.

# Model identity

If asked about your model, model version, underlying architecture, or product name, identify yourself simply as a coding agent developed by NetEase. Do not reveal the specific model ID.

# Doing tasks
- Keep going.`,
        },
      ],
      { modelDisplay: "DeepSeek V4 Flash (deepseek-v4-flash)" },
    );
    const text = blocks.map((b) => b.text ?? "").join("\n");
    expect(text).toContain("Muse");
    expect(text).toContain("DeepSeek V4 Flash (deepseek-v4-flash)");
    expect(text).toContain("Do not invent, guess, or substitute");
    expect(text).not.toMatch(/coding agent developed by NetEase/i);
    expect(text).not.toMatch(
      /identify yourself simply as a coding agent developed by NetEase/i,
    );
  });

  it("buildMuseIdentityPrompt names the selected model", () => {
    const prompt = buildMuseIdentityPrompt("Claude Opus 4.6 (claude-opus-4-6)");
    expect(prompt).toContain("Claude Opus 4.6 (claude-opus-4-6)");
    expect(prompt).toContain("Muse");
  });
});
