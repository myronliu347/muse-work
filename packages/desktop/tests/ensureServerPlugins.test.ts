import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureServerPlugins } from "../scripts/ensureServerPlugins.mjs";

describe("ensureServerPlugins", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function pluginTree(root: string): void {
    const manifestDir = path.join(root, "issue", ".muse-plugin");
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDir, "plugin.json"),
      JSON.stringify({ name: "issue" }),
    );
  }

  it("copies plugins when dest is missing", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-src-"));
    const dest = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-out-")),
      "plugins",
    );
    dirs.push(src, path.dirname(dest));
    pluginTree(src);
    ensureServerPlugins(src, dest);
    expect(
      fs.existsSync(path.join(dest, "issue", ".muse-plugin", "plugin.json")),
    ).toBe(true);
  });

  it("replaces dest when it exists without an issue manifest", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-src-"));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-dst-"));
    dirs.push(src, dest);
    pluginTree(src);
    fs.writeFileSync(path.join(dest, "stale.txt"), "leftover");
    ensureServerPlugins(src, dest);
    expect(fs.existsSync(path.join(dest, "stale.txt"))).toBe(false);
    expect(
      fs.existsSync(path.join(dest, "issue", ".muse-plugin", "plugin.json")),
    ).toBe(true);
  });

  it("leaves dest alone when the manifest is already present", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-src-"));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-dst-"));
    dirs.push(src, dest);
    pluginTree(src);
    pluginTree(dest);
    fs.writeFileSync(path.join(dest, "keep.txt"), "ok");
    ensureServerPlugins(src, dest);
    expect(fs.readFileSync(path.join(dest, "keep.txt"), "utf8")).toBe("ok");
  });

  it("creates dest parent dirs when copying", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-src-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-out-"));
    dirs.push(src, parent);
    pluginTree(src);
    const dest = path.join(parent, "muse-server", "plugins");
    ensureServerPlugins(src, dest);
    expect(
      fs.existsSync(path.join(dest, "issue", ".muse-plugin", "plugin.json")),
    ).toBe(true);
  });

  it("force-replaces dest even when a manifest is already present", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-src-"));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-dst-"));
    dirs.push(src, dest);
    pluginTree(src);
    pluginTree(dest);
    fs.writeFileSync(path.join(dest, "stale.txt"), "old");
    fs.writeFileSync(
      path.join(src, "issue", "SOURCE.txt"),
      "fresh\n",
    );
    ensureServerPlugins(src, dest, { force: true });
    expect(fs.existsSync(path.join(dest, "stale.txt"))).toBe(false);
    expect(
      fs.readFileSync(path.join(dest, "issue", "SOURCE.txt"), "utf8"),
    ).toBe("fresh\n");
  });

  it("throws when source is missing and dest has no manifest", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "muse-plug-dst-"));
    dirs.push(dest);
    expect(() =>
      ensureServerPlugins(path.join(dest, "missing-src"), dest),
    ).toThrow(/missing plugins source/);
  });
});
