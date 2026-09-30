import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePluginDir } from "../src/services/museSettings.js";

const pluginDir = resolvePluginDir("superpowers");

describe("superpowers builtin plugin", () => {
  it("has Wave manifest, LICENSE, and using-superpowers skill", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pluginDir, ".muse-plugin", "plugin.json"),
        "utf8",
      ),
    ) as { name: string; version: string };
    expect(manifest.name).toBe("superpowers");
    expect(manifest.version).toBe("6.3.0");
    expect(fs.existsSync(path.join(pluginDir, "LICENSE"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(pluginDir, "skills", "using-superpowers", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("session-start hook injects using-superpowers as additionalContext", () => {
    const script = path.join(pluginDir, "scripts", "session-start.js");
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, WAVE_PLUGIN_ROOT: pluginDir },
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "You have superpowers",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "using-superpowers",
    );
  });
});
