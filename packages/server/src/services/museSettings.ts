import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLogger } from "../utils/logger.js";
import {
  getSettingsPath,
  resolvePluginDir,
} from "../utils/paths.js";

export type MuseSettings = {
  version: 1;
  plugins: { superpowers: boolean; mattpocock: boolean };
};

const DEFAULT_SETTINGS: MuseSettings = {
  version: 1,
  plugins: { superpowers: false, mattpocock: true },
};

function isSettings(value: unknown): value is MuseSettings {
  if (!value || typeof value !== "object") return false;
  const plugins = (value as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return false;
  const { superpowers, mattpocock } = plugins as {
    superpowers?: unknown;
    mattpocock?: unknown;
  };
  return (
    (superpowers === undefined || typeof superpowers === "boolean") &&
    (mattpocock === undefined || typeof mattpocock === "boolean")
  );
}

export function loadMuseSettings(home = os.homedir()): MuseSettings {
  const file = getSettingsPath(home);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!isSettings(raw)) {
      getLogger().warn("settings.json invalid, using defaults", { file });
      return { ...DEFAULT_SETTINGS, plugins: { ...DEFAULT_SETTINGS.plugins } };
    }
    return {
      version: 1,
      plugins: {
        superpowers: raw.plugins.superpowers ?? false,
        mattpocock: raw.plugins.mattpocock ?? true,
      },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      getLogger().warn("settings.json unreadable, using defaults", {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ...DEFAULT_SETTINGS, plugins: { ...DEFAULT_SETTINGS.plugins } };
  }
}

export function saveMuseSettings(
  settings: MuseSettings,
  home = os.homedir(),
): void {
  const file = getSettingsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function patchMuseSettings(
  patch: { plugins: { superpowers?: boolean; mattpocock?: boolean } },
  home = os.homedir(),
): MuseSettings {
  const current = loadMuseSettings(home);
  const next: MuseSettings = {
    version: 1,
    plugins: {
      ...current.plugins,
      superpowers:
        patch.plugins.superpowers ?? current.plugins.superpowers,
      mattpocock: patch.plugins.mattpocock ?? current.plugins.mattpocock,
    },
  };
  saveMuseSettings(next, home);
  return next;
}

export function pluginDirIfPresent(pluginName: string): string | undefined {
  const dir = resolvePluginDir(pluginName);
  const hasManifest = [".muse-plugin", ".wave-plugin", ".claude-plugin"].some(
    (name) => fs.existsSync(path.join(dir, name, "plugin.json")),
  );
  if (!hasManifest) {
    getLogger().error(`${pluginName} plugin directory missing`, { dir });
    return undefined;
  }
  return dir;
}

export {
  findServerPackageRoot,
  getSettingsPath,
  resolvePluginDir,
  resolvePluginDirFrom,
} from "../utils/paths.js";
