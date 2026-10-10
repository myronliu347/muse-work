import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadMergedMuseConfig } = vi.hoisted(() => ({
  loadMergedMuseConfig: vi.fn(),
}));

vi.mock("@/services/configurationService.js", () => ({
  loadMergedMuseConfig,
}));

import {
  LEAN_PROMPT_DEFAULT_ENABLED,
  isLeanPromptEnabled,
} from "@/services/leanPrompt.js";

describe("isLeanPromptEnabled", () => {
  beforeEach(() => {
    loadMergedMuseConfig.mockReset();
  });

  it("is on unless settings opt out", () => {
    expect(LEAN_PROMPT_DEFAULT_ENABLED).toBe(true);
    loadMergedMuseConfig.mockReturnValue(null);
    expect(isLeanPromptEnabled("/repo")).toBe(true);
    expect(isLeanPromptEnabled()).toBe(true);
  });

  it("honors an explicit setting, including false", () => {
    loadMergedMuseConfig.mockReturnValue({ leanPrompt: true });
    expect(isLeanPromptEnabled("/repo")).toBe(true);

    loadMergedMuseConfig.mockReturnValue({ leanPrompt: false });
    expect(isLeanPromptEnabled("/repo")).toBe(false);
  });

  it("falls back to the default when settings cannot be read", () => {
    loadMergedMuseConfig.mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(isLeanPromptEnabled("/repo")).toBe(true);
  });
});
