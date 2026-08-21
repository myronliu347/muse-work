import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findServerPackageRoot,
  getSettingsPath,
  loadMuseSettings,
  patchMuseSettings,
  pluginDirIfPresent,
  resolvePluginDir,
  resolvePluginDirFrom,
  saveMuseSettings,
} from "../src/services/museSettings.js";

describe("museSettings", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("defaults mattpocock on and superpowers off when the file is missing", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    expect(loadMuseSettings(home)).toEqual({
      version: 1,
      plugins: { superpowers: false, mattpocock: true },
    });
    expect(fs.existsSync(getSettingsPath(home))).toBe(false);
  });

  it("defaults mattpocock on and superpowers off when JSON is corrupt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    const file = getSettingsPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not-json");
    expect(loadMuseSettings(home).plugins).toEqual({
      superpowers: false,
      mattpocock: true,
    });
  });

  it("honors explicit values and round-trips via patch", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    saveMuseSettings(
      {
        version: 1,
        plugins: { superpowers: false, mattpocock: true },
      },
      home,
    );
    expect(loadMuseSettings(home).plugins).toEqual({
      superpowers: false,
      mattpocock: true,
    });
    const next = patchMuseSettings(
      { plugins: { superpowers: true } },
      home,
    );
    expect(next.plugins).toEqual({
      superpowers: true,
      mattpocock: true,
    });
    expect(loadMuseSettings(home).plugins).toEqual({
      superpowers: true,
      mattpocock: true,
    });
    const onlyMattpocock = patchMuseSettings(
      { plugins: { mattpocock: false } },
      home,
    );
    expect(onlyMattpocock.plugins).toEqual({
      superpowers: true,
      mattpocock: false,
    });
  });

  it("walks up from a nested path to the @muse-work/server package root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-pkg-"));
    homes.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@muse-work/server" }),
    );
    const nested = path.join(root, "dist", "nested");
    fs.mkdirSync(nested, { recursive: true });
    expect(findServerPackageRoot(nested)).toBe(root);
  });

  it("skips intervening package.json that is not @muse-work/server", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-pkg-"));
    homes.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@muse-work/server" }),
    );
    const other = path.join(root, "dist");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(
      path.join(other, "package.json"),
      JSON.stringify({ name: "some-nested-pkg" }),
    );
    expect(findServerPackageRoot(path.join(other, "deep"))).toBe(root);
  });

  it("returns undefined when no server package is found", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-pkg-"));
    homes.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "unrelated" }),
    );
    expect(findServerPackageRoot(root)).toBeUndefined();
  });

  it("falls back to dist/plugins when package-root plugins are missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-pkg-"));
    homes.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@muse-work/server" }),
    );
    const fromDir = path.join(root, "dist");
    const pluginDir = path.join(
      fromDir,
      "plugins",
      "superpowers",
    );
    fs.mkdirSync(path.join(pluginDir, ".wave-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, ".wave-plugin", "plugin.json"),
      JSON.stringify({ name: "superpowers" }),
    );
    expect(resolvePluginDirFrom(fromDir, "superpowers")).toBe(pluginDir);
  });

  it("resolves the vendored plugin manifests from the server package root", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = findServerPackageRoot(here);
    expect(root).toBeTruthy();
    for (const name of ["superpowers", "mattpocock"]) {
      const dir = resolvePluginDir(name);
      expect(dir).toBe(path.join(root as string, "plugins", name));
      expect(
        fs.existsSync(path.join(dir, ".wave-plugin", "plugin.json")),
      ).toBe(true);
      expect(pluginDirIfPresent(name)).toBe(dir);
    }
  });
});
