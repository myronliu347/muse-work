import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLogger } from "../utils/logger.js";
import { resolvePluginDir } from "../utils/paths.js";

export type MuseSettings = {
  version: 1;
};

export function loadMuseSettings(_home = os.homedir()): MuseSettings {
  return { version: 1 };
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
