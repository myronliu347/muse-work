import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMuseHomeDir } from "@muse-work/provider";
import { getLogger } from "./logger.js";

export type MuseSettings = {
  version: 1;
  plugins: { superpowers: boolean };
};

const DEFAULT_SETTINGS: MuseSettings = {
  version: 1,
  plugins: { superpowers: true },
};

export function getSettingsPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "settings.json");
}

function isSettings(value: unknown): value is MuseSettings {
  if (!value || typeof value !== "object") return false;
  const plugins = (value as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return false;
  const superpowers = (plugins as { superpowers?: unknown }).superpowers;
  return superpowers === undefined || typeof superpowers === "boolean";
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
        superpowers: raw.plugins.superpowers ?? true,
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
  patch: { plugins: { superpowers: boolean } },
  home = os.homedir(),
): MuseSettings {
  const current = loadMuseSettings(home);
  const next: MuseSettings = {
    version: 1,
    plugins: {
      ...current.plugins,
      superpowers: patch.plugins.superpowers,
    },
  };
  saveMuseSettings(next, home);
  return next;
}

/** `packages/server/src/*.ts` 与 `dist/*.js` 的 `../plugins/superpowers`。 */
export function resolveSuperpowersPluginDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "plugins",
    "superpowers",
  );
}

export function superpowersPluginDirIfPresent(): string | undefined {
  const dir = resolveSuperpowersPluginDir();
  const manifest = path.join(dir, ".wave-plugin", "plugin.json");
  if (!fs.existsSync(manifest)) {
    getLogger().error("superpowers plugin directory missing", { dir });
    return undefined;
  }
  return dir;
}
