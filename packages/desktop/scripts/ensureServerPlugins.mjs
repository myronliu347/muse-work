import fs from "node:fs";
import path from "node:path";

export function superpowersManifestPath(pluginsDir) {
  return path.join(pluginsDir, "superpowers", ".muse-plugin", "plugin.json");
}

/**
 * Ensure `pluginsDest` contains the Superpowers Wave manifest.
 * Copies from `pluginsSrc` when dest is missing/incomplete, or when `force`.
 */
export function ensureServerPlugins(pluginsSrc, pluginsDest, opts = {}) {
  const manifest = superpowersManifestPath(pluginsDest);
  if (opts.force || !fs.existsSync(manifest)) {
    if (!fs.existsSync(pluginsSrc)) {
      throw new Error(`[prepareServer] missing plugins source: ${pluginsSrc}`);
    }
    fs.rmSync(pluginsDest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(pluginsDest), { recursive: true });
    fs.cpSync(pluginsSrc, pluginsDest, { recursive: true });
    console.log("[prepareServer] copied plugins to", pluginsDest);
  }
  if (!fs.existsSync(manifest)) {
    throw new Error(`[prepareServer] missing superpowers manifest: ${manifest}`);
  }
}
