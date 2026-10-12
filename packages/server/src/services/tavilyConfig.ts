import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

export type TavilyKeySource = "stored" | "env" | "none";

export type TavilyKeyStatus = {
  configured: boolean;
  source: TavilyKeySource;
};

export function tavilyConfigPath(home: string): string {
  return path.join(getMuseHomeDir(home), "tavily.json");
}

export function loadStoredTavilyApiKey(home: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(tavilyConfigPath(home), "utf8")) as {
      apiKey?: unknown;
    };
    return typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  } catch {
    return "";
  }
}

/** 页面保存的密钥优先，否则用环境变量 TAVILY_API_KEY。 */
export function resolveTavilyApiKey(home: string): {
  key: string;
  source: TavilyKeySource;
} {
  const stored = loadStoredTavilyApiKey(home);
  if (stored) return { key: stored, source: "stored" };
  const env = (process.env.TAVILY_API_KEY ?? "").trim();
  if (env) return { key: env, source: "env" };
  return { key: "", source: "none" };
}

export function tavilyKeyStatus(home: string): TavilyKeyStatus {
  const { source } = resolveTavilyApiKey(home);
  return { configured: source !== "none", source };
}

export function saveTavilyApiKey(home: string, apiKey: string): void {
  const file = tavilyConfigPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ apiKey }, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // ignore chmod failures on unsupported FS
  }
}

export function clearStoredTavilyApiKey(home: string): void {
  try {
    fs.unlinkSync(tavilyConfigPath(home));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
