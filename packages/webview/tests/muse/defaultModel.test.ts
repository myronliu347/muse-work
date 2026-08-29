import { describe, it, expect } from "vitest";
import {
  DEFAULT_SESSION_MODEL_ID,
  resolveDraftModel,
  type DraftAgentLike,
} from "../../src/muse/defaultModel";

const AGENTS: DraftAgentLike[] = [
  { key: "default", model: "deepseek-v4-pro" },
  { key: "xiaomei", model: "claude-opus-4-6" },
];

describe("resolveDraftModel", () => {
  it("uses the session default agent model when no agent selected and currentModel is untouched", () => {
    expect(
      resolveDraftModel(
        DEFAULT_SESSION_MODEL_ID,
        undefined,
        "default",
        AGENTS,
      ),
    ).toBe("deepseek-v4-pro");
  });

  it("uses the session default agent model when currentModel is undefined", () => {
    expect(resolveDraftModel(undefined, undefined, "default", AGENTS)).toBe(
      "deepseek-v4-pro",
    );
  });

  it("uses the selected draft agent's model (agentName wins over default)", () => {
    expect(
      resolveDraftModel(
        DEFAULT_SESSION_MODEL_ID,
        "xiaomei",
        "default",
        AGENTS,
      ),
    ).toBe("claude-opus-4-6");
  });

  it("keeps the user's manual model pick even when an agent model exists", () => {
    expect(
      resolveDraftModel("deepseek-v4-pro", "xiaomei", "default", AGENTS),
    ).toBe("deepseek-v4-pro");
  });

  it("falls back to the hard default when the agent is unknown", () => {
    expect(
      resolveDraftModel(undefined, "ghost", "default", AGENTS),
    ).toBe(DEFAULT_SESSION_MODEL_ID);
  });

  it("falls back to the hard default when agents are not loaded yet", () => {
    expect(resolveDraftModel(undefined, undefined, "default", [])).toBe(
      DEFAULT_SESSION_MODEL_ID,
    );
  });

  it("honors an explicit fallback argument when no agent model resolves", () => {
    expect(
      resolveDraftModel(undefined, "ghost", "default", [], "custom"),
    ).toBe("custom");
  });
});
