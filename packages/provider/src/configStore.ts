import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProvidersConfigPath } from "./paths.js";
import type { ProviderBlock, ProvidersFile } from "./types.js";

/** Default model for new sessions. */
export const DEFAULT_ACTIVE_MODEL_ID = "deepseek-flash";

function defaultProvidersConfig(): ProvidersFile {
  return {
    activeProviderId: "deepseek",
    activeModelId: DEFAULT_ACTIVE_MODEL_ID,
    providers: {
      deepseek: {
        enabled: true,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: [{ id: DEFAULT_ACTIVE_MODEL_ID, label: "DeepSeek Flash" }],
      },
      codex: {
        enabled: true,
        // Used only when the signed-in `/models` catalog cannot be loaded.
        models: [
          { id: "gpt-5.4", label: "GPT-5.4" },
          { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
        ],
      },
      "openai-compatible": {
        enabled: true,
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "MUSE_OPENAI_API_KEY",
        models: [
          { id: "gpt-4.1", label: "GPT-4.1" },
          { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
        ],
      },
    },
  };
}

const BUILTIN_PROVIDER_IDS = new Set([
  "deepseek",
  "codex",
  "openai-compatible",
]);

function hostedProviders(
  raw: Record<string, unknown> | undefined,
): Record<string, ProviderBlock> {
  const hosted: Record<string, ProviderBlock> = {};
  if (!raw) return hosted;
  for (const [id, block] of Object.entries(raw)) {
    if (BUILTIN_PROVIDER_IDS.has(id)) continue;
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    hosted[id] = block as ProviderBlock;
  }
  return hosted;
}

function mergeProvidersConfig(raw: ProvidersFile): ProvidersFile {
  const defaults = defaultProvidersConfig();
  const incoming = raw.providers as unknown as Record<string, unknown> | undefined;
  return {
    activeProviderId: raw.activeProviderId || defaults.activeProviderId,
    activeModelId: raw.activeModelId ?? defaults.activeModelId,
    providers: {
      deepseek: raw.providers?.deepseek ?? defaults.providers.deepseek,
      codex: raw.providers?.codex ?? defaults.providers.codex,
      "openai-compatible":
        raw.providers?.["openai-compatible"] ??
        defaults.providers["openai-compatible"],
      ...hostedProviders(incoming),
    },
  };
}

export function loadProvidersConfig(home = os.homedir()): ProvidersFile {
  const configPath = getProvidersConfigPath(home);
  if (!fs.existsSync(configPath)) {
    return defaultProvidersConfig();
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return mergeProvidersConfig(JSON.parse(raw) as ProvidersFile);
}

export function saveProvidersConfig(
  cfg: ProvidersFile,
  home = os.homedir(),
): void {
  const configPath = getProvidersConfigPath(home);
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  // Ensure permissions even when the file already existed (mode on writeFile
  // only applies to newly created files on some platforms).
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // ignore chmod failures on unsupported FS
  }
}
