import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { getLogger } from "../utils/logger.js";

/** User-scope agent settings: `<muse-home>/settings.json` (default `~/.muse-work`). */
export function getWaveUserSettingsPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "settings.json");
}

/** First-launch defaults when `~/.muse-work/settings.json` does not exist. */
export const DEFAULT_WAVE_USER_SETTINGS = {
  env: {
    MUSE_MAX_INPUT_TOKENS: "800000",
    MUSE_VISION_MODEL: "kimi-k3",
  },
  models: {
    "glm-5.2": {
      capabilities: {
        vision: false,
      },
    },
    "kimi-k3": {},
    "qwen3.8-max": {
      capabilities: {
        promptCaching: true,
      },
    },
    "deepseek-flash": {
      capabilities: {
        vision: false,
      },
      disableThinkingOptions: {
        thinking: {
          type: "disabled",
        },
      },
    },
    "deepseek-v4-flash": {
      capabilities: {
        vision: false,
      },
      disableThinkingOptions: {
        thinking: {
          type: "disabled",
        },
      },
    },
  },
} as const;

const EMPTY_SETTINGS = "{}\n";

/** 启动时若无 `~/.muse-work/settings.json` 则写入内置默认，已有文件不覆盖。 */
export function ensureDefaultWaveUserSettings(home = os.homedir()): void {
  const file = getWaveUserSettingsPath(home);
  if (fs.existsSync(file)) return;
  try {
    writeWaveUserSettingsText(
      JSON.stringify(DEFAULT_WAVE_USER_SETTINGS),
      home,
    );
  } catch (err) {
    getLogger().warn("failed to write default wave settings", {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export class WaveSettingsJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaveSettingsJsonError";
  }
}

/** Pretty-printed `~/.muse-work/settings.json` text for the Agent settings editor. */
export function readWaveUserSettingsText(home = os.homedir()): {
  path: string;
  content: string;
} {
  const file = getWaveUserSettingsPath(home);
  try {
    const content = fs.readFileSync(file, "utf8");
    try {
      return {
        path: file,
        content: `${JSON.stringify(JSON.parse(content), null, 2)}\n`,
      };
    } catch {
      return { path: file, content };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: file, content: EMPTY_SETTINGS };
    }
    throw err;
  }
}

/**
 * Parse + validate editor JSON, write `~/.muse-work/settings.json`.
 * Root must be a non-array object (Wave settings schema is otherwise freeform).
 */
export function writeWaveUserSettingsText(
  content: string,
  home = os.homedir(),
): { path: string; content: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new WaveSettingsJsonError("JSON 格式无效");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WaveSettingsJsonError("根节点必须是 JSON 对象");
  }

  const file = getWaveUserSettingsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const next = `${JSON.stringify(parsed, null, 2)}\n`;
  fs.writeFileSync(file, next, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return { path: file, content: next };
}
