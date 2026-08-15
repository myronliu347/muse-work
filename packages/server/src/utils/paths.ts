import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMuseHomeDir } from "@muse-work/provider";

const SERVER_PACKAGE_NAME = "@muse-work/server";

/**
 * Resolve config home: explicit option → `MUSE_HOME` env → `os.homedir()`.
 * `MUSE_HOME` is the parent directory that contains `.muse-work/` (same as
 * `os.homedir()` semantics), so tests can point at a temp dir.
 */
export function resolveHome(home?: string): string {
  return home ?? process.env.MUSE_HOME ?? os.homedir();
}

export function getSettingsPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "settings.json");
}

/** Walk up from `fromDir` until `package.json` name is `@muse-work/server`. */
export function findServerPackageRoot(fromDir: string): string | undefined {
  let dir = path.resolve(fromDir);
  for (;;) {
    const pkgFile = path.join(dir, "package.json");
    try {
      const raw = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as {
        name?: unknown;
      };
      if (raw.name === SERVER_PACKAGE_NAME) return dir;
    } catch {
      // Missing or invalid package.json: keep walking.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function hasSuperpowersManifest(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".wave-plugin", "plugin.json"));
}

export function resolveSuperpowersPluginDirFrom(fromDir: string): string {
  const root = findServerPackageRoot(fromDir);
  const candidates = [
    root ? path.join(root, "plugins", "superpowers") : "",
    path.join(fromDir, "plugins", "superpowers"),
    path.resolve(fromDir, "..", "plugins", "superpowers"),
  ].filter((dir, i, all) => dir && all.indexOf(dir) === i);

  for (const dir of candidates) {
    if (hasSuperpowersManifest(dir)) return dir;
  }
  return (
    candidates[0] ?? path.resolve(fromDir, "..", "plugins", "superpowers")
  );
}

/** Plugin dir next to the server package root, or `dist/plugins` after tsc. */
export function resolveSuperpowersPluginDir(): string {
  return resolveSuperpowersPluginDirFrom(
    path.dirname(fileURLToPath(import.meta.url)),
  );
}
