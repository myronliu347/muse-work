import { describe, expect, it } from "vitest";
import {
  envGet,
  MUSE_ENV,
  museEnvLegacy,
  pluginRootEnv,
  substitutePluginRoot,
} from "../../src/utils/museEnv.js";

describe("museEnv", () => {
  it("maps MUSE_* keys to WAVE_* legacy names", () => {
    expect(museEnvLegacy(MUSE_ENV.API_KEY)).toBe("WAVE_API_KEY");
    expect(museEnvLegacy(MUSE_ENV.SERVER_URL)).toBe("WAVE_SERVER_URL");
  });

  it("prefers MUSE_* over WAVE_* in the same source", () => {
    expect(
      envGet(MUSE_ENV.MODEL, {
        MUSE_MODEL: "muse-model",
        WAVE_MODEL: "wave-model",
      }),
    ).toBe("muse-model");
  });

  it("falls back to WAVE_* when MUSE_* is absent", () => {
    expect(
      envGet(MUSE_ENV.MODEL, { WAVE_MODEL: "wave-model" }),
    ).toBe("wave-model");
  });

  it("searches later sources when earlier ones omit both keys", () => {
    expect(
      envGet(
        MUSE_ENV.API_KEY,
        { OTHER: "x" },
        { WAVE_API_KEY: "legacy-key" },
      ),
    ).toBe("legacy-key");
  });

  it("injects MUSE, WAVE, and CLAUDE plugin root aliases", () => {
    expect(pluginRootEnv("/p")).toEqual({
      MUSE_PLUGIN_ROOT: "/p",
      WAVE_PLUGIN_ROOT: "/p",
      CLAUDE_PLUGIN_ROOT: "/p",
    });
  });

  it("substitutes MUSE, WAVE, and CLAUDE plugin-root placeholders", () => {
    expect(
      substitutePluginRoot(
        "${MUSE_PLUGIN_ROOT}/a ${WAVE_PLUGIN_ROOT}/b ${CLAUDE_PLUGIN_ROOT}/c",
        "/p",
      ),
    ).toBe("/p/a /p/b /p/c");
  });
});
