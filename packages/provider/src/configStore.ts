import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProvidersConfigPath } from "./paths.js";
import type { ProvidersFile } from "./types.js";

function defaultProvidersConfig(): ProvidersFile {
  return {
    activeProviderId: "codemaker",
    activeModelId: "deepseek-v4-pro",
    providers: {
      codemaker: {
        enabled: true,
        models: [
          { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
          { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
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

export function loadProvidersConfig(home = os.homedir()): ProvidersFile {
  const configPath = getProvidersConfigPath(home);
  if (!fs.existsSync(configPath)) {
    return defaultProvidersConfig();
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as ProvidersFile;
}

export function saveProvidersConfig(
  cfg: ProvidersFile,
  home = os.homedir(),
): void {
  const configPath = getProvidersConfigPath(home);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}
