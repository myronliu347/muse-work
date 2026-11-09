import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir, loadProvidersConfig, saveProvidersConfig } from "@muse-work/provider";
import type { PluginLogger } from "@muse-work/plugin-sdk";

/** Fixed manifest. Each publish overwrites this file. Versioned bundles are append-only. */
export const NETEASE_PLUGIN_MANIFEST_URL =
  "https://minio-api.codewave-test.163yun.com/lowcode-static/muse-plugin-netease/latest.json";

const MANIFEST_HOST = "minio-api.codewave-test.163yun.com";

export type NeteaseManifest = {
  version: string;
  url: string;
};

export function neteasePluginPath(home: string): string {
  return path.join(getMuseHomeDir(home), "host-plugins", "netease.js");
}

function versionStampPath(home: string): string {
  return path.join(getMuseHomeDir(home), "host-plugins", "netease.version");
}

/** Accept only the versioned `netease.js` bundle. Never a `.map`. */
export function parseNeteaseManifest(raw: unknown): NeteaseManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { version?: unknown; url?: unknown };
  if (typeof row.version !== "string" || !row.version.trim()) return null;
  if (typeof row.url !== "string" || !row.url.trim()) return null;
  let url: URL;
  try {
    url = new URL(row.url.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== MANIFEST_HOST) return null;
  if (!url.pathname.includes("/muse-plugin-netease/")) return null;
  if (!url.pathname.endsWith("/netease.js")) return null;
  return { version: row.version.trim(), url: url.toString() };
}

function readInstalledVersion(home: string): string | null {
  try {
    const version = fs.readFileSync(versionStampPath(home), "utf8").trim();
    return version || null;
  } catch {
    return null;
  }
}

/**
 * Download the intranet Netease plugin into `~/.muse-work/host-plugins/netease.js`.
 * The host loads that local file. The manifest URL is never written into host-plugins.json.
 * A failed fetch leaves the previously installed file in place.
 */
export async function syncNeteasePlugin(options: {
  home: string;
  logger: PluginLogger;
  fetch?: typeof fetch;
  manifestUrl?: string;
}): Promise<{ status: "installed" | "current" | "skipped"; version?: string; reason?: string }> {
  const fetchImpl = options.fetch ?? fetch;
  const dest = neteasePluginPath(options.home);
  let response: Response;
  try {
    response = await fetchImpl(options.manifestUrl ?? NETEASE_PLUGIN_MANIFEST_URL, {
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    options.logger.warn("netease plugin manifest unavailable", { error: reason });
    return { status: "skipped", reason };
  }
  if (!response.ok) {
    const reason = `HTTP ${response.status}`;
    options.logger.warn("netease plugin manifest unavailable", { error: reason });
    return { status: "skipped", reason };
  }
  let manifest: NeteaseManifest | null;
  try {
    manifest = parseNeteaseManifest(await response.json());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    options.logger.warn("netease plugin manifest unreadable", { error: reason });
    return { status: "skipped", reason };
  }
  if (!manifest) {
    options.logger.warn("netease plugin manifest rejected");
    return { status: "skipped", reason: "invalid manifest" };
  }
  if (readInstalledVersion(options.home) === manifest.version && fs.existsSync(dest)) {
    return { status: "current", version: manifest.version };
  }
  let bundle: Response;
  try {
    bundle = await fetchImpl(manifest.url, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    options.logger.warn("netease plugin download failed", { error: reason });
    return { status: "skipped", version: manifest.version, reason };
  }
  if (!bundle.ok) {
    const reason = `HTTP ${bundle.status}`;
    options.logger.warn("netease plugin download failed", { error: reason });
    return { status: "skipped", version: manifest.version, reason };
  }
  const bytes = Buffer.from(await bundle.arrayBuffer());
  if (bytes.length === 0) {
    options.logger.warn("netease plugin download was empty");
    return { status: "skipped", version: manifest.version, reason: "empty bundle" };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, dest);
  fs.writeFileSync(versionStampPath(options.home), `${manifest.version}\n`);
  options.logger.info("netease plugin installed", { version: manifest.version });
  return { status: "installed", version: manifest.version };
}

/**
 * Use CodeMaker unless the user already picked Codex, an OpenAI-compatible
 * endpoint, or DeepSeek with a key. The Netease plugin registers that provider.
 */
export function selectCodeMakerProvider(home: string): boolean {
  const cfg = loadProvidersConfig(home);
  const deepseekKey =
    cfg.providers.deepseek?.apiKey?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  const chosen = cfg.activeProviderId;
  const keepExplicit =
    chosen === "codex" ||
    chosen === "openai-compatible" ||
    (chosen === "deepseek" && Boolean(deepseekKey));
  if (keepExplicit) return false;
  const switching = cfg.activeProviderId !== "codemaker";
  cfg.activeProviderId = "codemaker";
  if (!cfg.providers.codemaker?.models?.length) {
    cfg.providers.codemaker = {
      enabled: true,
      models: [{ id: "deepseek-flash", label: "DeepSeek Flash" }],
    };
  }
  if (switching || !cfg.activeModelId) {
    cfg.activeModelId = cfg.providers.codemaker.models[0]?.id ?? "deepseek-flash";
  }
  saveProvidersConfig(cfg, home);
  return true;
}
