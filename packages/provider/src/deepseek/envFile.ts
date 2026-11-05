import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEEPSEEK_API_KEY_ENV } from "./provider.js";

/** Shared across dev and production. Ignores `MUSE_HOME_DIR`. */
export function deepSeekEnvFile(home = os.homedir()): string {
  return path.join(home, ".muse-work", "env");
}

export function loadDeepSeekEnv(home = os.homedir()): void {
  if (process.env[DEEPSEEK_API_KEY_ENV]?.trim()) return;
  const file = deepSeekEnvFile(home);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== DEEPSEEK_API_KEY_ENV) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env[DEEPSEEK_API_KEY_ENV] = value;
    return;
  }
}

export function saveDeepSeekApiKey(apiKey: string, home = os.homedir()): void {
  const value = apiKey.trim();
  if (!value) throw new Error("API Key 不能为空");
  process.env[DEEPSEEK_API_KEY_ENV] = value;
  const file = deepSeekEnvFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  let found = false;
  const next = existing.map((line) => {
    if (line.trim().startsWith(`${DEEPSEEK_API_KEY_ENV}=`)) {
      found = true;
      return `${DEEPSEEK_API_KEY_ENV}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${DEEPSEEK_API_KEY_ENV}=${value}`);
  const body = `${next.filter((line) => line.trim().length > 0).join("\n")}\n`;
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // ignore chmod failures on unsupported FS
  }
}
