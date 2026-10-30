import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "../paths.js";
import type { ModelInfo } from "../types.js";
import type { CodexCreds } from "./credentials.js";

export const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** Sent as `client_version` on the Codex `/models` catalog request. */
export const CODEX_MODELS_CLIENT_VERSION = "0.0.0";

/** Same freshness window as the CodeMaker catalog cache. */
export const CODEX_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

export function getCodexModelsCachePath(home: string): string {
  return path.join(getMuseHomeDir(home), "codex-models.json");
}

interface RemoteCodexModel {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  input_modalities?: unknown;
  supported_reasoning_levels?: unknown;
}

/**
 * Map the Codex `/models` payload into picker entries.
 * Only `visibility: "list"` models are shown; hidden and internal slugs drop out.
 */
export function parseCodexModels(payload: unknown): ModelInfo[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { models?: unknown }).models;
  if (!Array.isArray(raw)) return [];
  const out: ModelInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const model = item as RemoteCodexModel;
    if (model.visibility !== "list") continue;
    if (typeof model.slug !== "string" || model.slug.length === 0) continue;
    const modalities = Array.isArray(model.input_modalities)
      ? model.input_modalities
      : [];
    const reasoning = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels
      : [];
    const vision = modalities.includes("image");
    const thinking = reasoning.length > 0;
    const capabilities =
      vision || thinking
        ? {
            ...(vision ? { vision: true } : {}),
            ...(thinking ? { thinking: true } : {}),
          }
        : undefined;
    const label =
      typeof model.display_name === "string" && model.display_name.length > 0
        ? model.display_name
        : model.slug;
    out.push({
      id: model.slug,
      label,
      ...(capabilities ? { capabilities } : {}),
    });
  }
  return out;
}

export interface CodexModelsLoader {
  /** Remote catalog, or null when signed out or the request fails. */
  list(): Promise<ModelInfo[] | null>;
}

export interface CodexModelsDeps {
  home?: string;
  fetch?: typeof fetch;
  now?: () => number;
  getCredentials?: () => CodexCreds | null | Promise<CodexCreds | null>;
}

interface CacheEntry {
  fetchedAt: number;
  accountId?: string;
  models: ModelInfo[];
}

export function createCodexModelsLoader(
  deps: CodexModelsDeps = {},
): CodexModelsLoader {
  const now = deps.now ?? Date.now;
  let memory: CacheEntry | null = null;
  let inflight: Promise<ModelInfo[] | null> | null = null;

  function fresh(entry: CacheEntry | null, accountId: string | undefined): entry is CacheEntry {
    return (
      !!entry &&
      entry.accountId === accountId &&
      now() - entry.fetchedAt <= CODEX_MODELS_CACHE_TTL_MS &&
      entry.models.length > 0
    );
  }

  function readDisk(accountId: string | undefined): CacheEntry | null {
    if (!deps.home) return null;
    try {
      const file = getCodexModelsCachePath(deps.home);
      if (!fs.existsSync(file)) return null;
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
        fetchedAt?: unknown;
        accountId?: unknown;
        models?: unknown;
      };
      if (typeof raw.fetchedAt !== "number" || !Array.isArray(raw.models)) {
        return null;
      }
      const entry: CacheEntry = {
        fetchedAt: raw.fetchedAt,
        accountId: typeof raw.accountId === "string" ? raw.accountId : undefined,
        models: raw.models as ModelInfo[],
      };
      return fresh(entry, accountId) ? entry : null;
    } catch {
      return null;
    }
  }

  function writeDisk(entry: CacheEntry): void {
    if (!deps.home) return;
    try {
      const file = getCodexModelsCachePath(deps.home);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n", {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch {
      // Cache is best-effort.
    }
  }

  async function fetchRemote(creds: CodexCreds): Promise<ModelInfo[] | null> {
    if (inflight) return inflight;
    inflight = (async () => {
      const fetchImpl = deps.fetch ?? globalThis.fetch;
      const url = new URL(`${CODEX_API_BASE_URL}/models`);
      url.searchParams.set("client_version", CODEX_MODELS_CLIENT_VERSION);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${creds.accessToken}`,
      };
      if (creds.accountId) {
        headers["chatgpt-account-id"] = creds.accountId;
      }
      try {
        const res = await fetchImpl(url, { headers });
        if (!res.ok) return null;
        const models = parseCodexModels(await res.json());
        return models.length > 0 ? models : null;
      } catch {
        return null;
      }
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  return {
    async list() {
      const creds = deps.getCredentials ? await deps.getCredentials() : null;
      if (!creds?.accessToken) return null;
      if (fresh(memory, creds.accountId)) return memory.models;
      const disk = readDisk(creds.accountId);
      if (disk) {
        memory = disk;
        return disk.models;
      }
      const remote = await fetchRemote(creds);
      if (remote) {
        memory = {
          fetchedAt: now(),
          accountId: creds.accountId,
          models: remote,
        };
        writeDisk(memory);
        return remote;
      }
      return null;
    },
  };
}
