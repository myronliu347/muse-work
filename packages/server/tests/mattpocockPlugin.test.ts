import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PluginLoader } from "@muse-work/agent";
import { resolvePluginDir } from "../src/services/museSettings.js";

const pluginDir = resolvePluginDir("mattpocock");

describe("mattpocock builtin plugin", () => {
  it("has Wave manifest, LICENSE, SOURCE.txt, and flat skills", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pluginDir, ".muse-plugin", "plugin.json"),
        "utf8",
      ),
    ) as { name: string; version: string };
    expect(manifest.name).toBe("mattpocock");
    expect(manifest.version).toBe("1.2.3");
    expect(fs.existsSync(path.join(pluginDir, "LICENSE"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "SOURCE.txt"))).toBe(true);
    // Skills must be flat (skills/<name>/SKILL.md); the SDK loader only scans
    // one level, so the upstream category nesting must be flattened.
    const skillsDir = path.join(pluginDir, "skills");
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    expect(entries.every((e) => e.isDirectory())).toBe(true);
    expect(
      entries.every((e) =>
        fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")),
      ),
    ).toBe(true);
  });

  it("SDK loads all 25 official skills with valid metadata", async () => {
    const skills = await PluginLoader.loadSkills(pluginDir);
    expect(skills.length).toBe(25);
    expect(skills.every((s) => s.isValid)).toBe(true);
    const names = skills.map((s) => s.name);
    for (const expected of [
      "grilling",
      "tdd",
      "code-review",
      "to-spec",
      "to-tickets",
      "domain-modeling",
      "diagnosing-bugs",
      "implement",
      "prototype",
      "research",
      "wayfinder",
      "triage",
      "wizard",
      "writing-for-agents",
      "teach",
      "handoff",
      "wait-what",
      "grill-me",
      "grill-with-docs",
      "ask-matt",
      "codebase-design",
      "resolving-merge-conflicts",
      "improve-codebase-architecture",
      "setup-matt-pocock-skills",
      "to-questionnaire",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
