/**
 * Exec feature availability.
 *
 * Exec collapses the MCP tool pool into a single scriptable tool, which changes
 * what the model sees in `tools[]`. Muse keeps the flat MCP tool list by
 * default; opt in with `enableExec: true` in settings.json.
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/** Code default for Exec availability. */
export const EXEC_DEFAULT_ENABLED = false;

/**
 * Whether the Exec tool may be registered for the given workdir.
 * Resolution order: remote managed settings (`enableExec` from
 * `GET /api/wave/settings`, admin override) → explicit `enableExec` in local
 * merged settings → code default.
 */
export function isExecEnabled(workdir?: string): boolean {
  const remote = getRemoteSettingsSync();
  if (remote?.enableExec !== undefined) {
    return remote.enableExec;
  }
  if (workdir) {
    const config = loadMergedWaveConfig(workdir);
    if (config?.enableExec !== undefined) {
      return config.enableExec;
    }
  }
  return EXEC_DEFAULT_ENABLED;
}
