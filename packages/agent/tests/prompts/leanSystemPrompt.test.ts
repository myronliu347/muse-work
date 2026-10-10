import { describe, it, expect } from "vitest";
import {
  LEAN_SYSTEM_PROMPT,
  OUTPUT_EFFICIENCY_PROMPT,
  SECURITY_NOTE,
  buildSystemPrompt,
} from "@/prompts/index.js";

describe("lean system prompt", () => {
  it("keeps the full static prompt when lean is off", () => {
    const [block] = buildSystemPrompt(undefined, [], { leanPrompt: false });

    expect(block.text).toContain("# Doing tasks");
    expect(block.text).toContain(OUTPUT_EFFICIENCY_PROMPT);
    expect(block.text).not.toContain(LEAN_SYSTEM_PROMPT);
    expect(block.text).not.toContain(SECURITY_NOTE);
  });

  it("collapses the static prompt to the harness block when lean is on", () => {
    const [block] = buildSystemPrompt(undefined, [], { leanPrompt: true });

    expect(block.text).toContain(SECURITY_NOTE);
    expect(block.text).toContain("# Harness");
    expect(block.text).not.toContain("# Doing tasks");
    expect(block.text).not.toContain("# Output efficiency");
  });
});
