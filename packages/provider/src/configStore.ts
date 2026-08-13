import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProvidersConfigPath } from "./paths.js";
import type { ProvidersFile } from "./types.js";

function defaultProvidersConfig(): ProvidersFile {
  return {
    activeProviderId: "codemaker",
    activeModelId: "deepseek-v4-flash",
    providers: {
      codemaker: {
        enabled: true,
        models: [
          { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
          { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
          { id: "claude-opus-5", label: "Claude Opus 5" },
          { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
          { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
          { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
          { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
          { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
          { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
          { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
          { id: "glm-5.2", label: "GLM 5.2" },
          { id: "gpt-5.4", label: "GPT-5.4" },
          { id: "gpt-5.5-2026-04-24", label: "GPT-5.5" },
          { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
          { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
          { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
          { id: "MiniMax-M3", label: "MiniMax M3" },
          { id: "qwen3.8-max", label: "Qwen 3.8 Max" },
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
