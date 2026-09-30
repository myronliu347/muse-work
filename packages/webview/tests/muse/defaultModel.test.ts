import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_MODEL_ID,
  resolveDraftModel,
} from "../../src/muse/defaultModel";

describe("resolveDraftModel", () => {
  it("prefers explicit currentModel when not the untouched default", () => {
    expect(resolveDraftModel("claude-opus", "deepseek-v4-flash")).toBe(
      "claude-opus",
    );
  });

  it("uses session scenario default model when current is default sentinel", () => {
    expect(
      resolveDraftModel(DEFAULT_SESSION_MODEL_ID, "deepseek-v4-flash"),
    ).toBe("deepseek-v4-flash");
  });

  it("falls back when no scenario model", () => {
    expect(resolveDraftModel(undefined, undefined)).toBe(
      DEFAULT_SESSION_MODEL_ID,
    );
  });
});
