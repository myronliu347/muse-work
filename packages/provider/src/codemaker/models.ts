import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "../paths.js";
import type { ModelInfo } from "../types.js";
import type { CodeMakerCreds } from "./types.js";
import {
  buildCodeMakerClientHeaders,
  createCodeMakerFetch,
} from "./sign.js";

/**
 * Dynamic model catalog served by the CodeMaker gateway. Requires a signed
 * session when the gateway gates the catalog (unauthenticated GETs may return
 * an empty `models` object). Falls back to the bundled config list when
 * unreachable.
 */
export const CODEMAKER_MODELS_API_URL =
  "https://api-code-maker.nie.netease.com/main/models/api.json";

/** Cache TTL mirroring the CodeMaker CLI (5 minutes). */
export const CODEMAKER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

export function getCodeMakerModelsCachePath(home: string): string {
  return path.join(getMuseHomeDir(home), "codemaker-models.json");
}

interface RemoteModel {
  id?: unknown;
  name?: unknown;
  attachment?: boolean;
  reasoning?: boolean;
  modalities?: { input?: string[] };
}

interface RemoteModelsPayload {
  "netease-codemaker"?: {
    models?: Record<string, RemoteModel> | RemoteModel[];
  };
}

/** Map the raw api.json model entries into muse-work ModelInfo. */
export function parseRemoteModels(payload: unknown): ModelInfo[] {
  if (!payload || typeof payload !== "object") return [];
  const provider = (payload as RemoteModelsPayload)["netease-codemaker"];
  const raw = provider?.models;
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  const out: ModelInfo[] = [];
  for (const m of entries) {
    if (!m || typeof m !== "object") continue;
    const id = m.id;
    const name = m.name;
    if (typeof id !== "string" || id.length === 0) continue;
    const vision =
      m.modalities?.input?.includes("image") || m.attachment === true;
    const thinking = m.reasoning === true;
    const capabilities =
      vision || thinking
        ? {
            ...(vision ? { vision: true } : {}),
            ...(thinking ? { thinking: true } : {}),
          }
        : undefined;
    out.push({
      id,
      label: typeof name === "string" && name.length > 0 ? name : id,
      ...(capabilities ? { capabilities } : {}),
    });
  }
  return out;
}

/**
 * Merge the remote catalog with the local config list. Remote entries win for
 * shared ids (label/capabilities); local-only ids (user custom models) are
 * preserved and appended.
 */
export function mergeModels(
  remote: ModelInfo[],
  local: ModelInfo[],
): ModelInfo[] {
  const remoteIds = new Set(remote.map((m) => m.id));
  return [...remote, ...local.filter((m) => !remoteIds.has(m.id))];
}

function isDeepSeek(m: ModelInfo): boolean {
  return (
    m.id.toLowerCase().startsWith("deepseek") ||
    m.label.toLowerCase().startsWith("deepseek")
  );
}

/**
 * Sort the model list for display: deepseek models pinned to the top (each
 * group sorted by label), then the rest alphabetically by label.
 */
export function sortModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const aDeep = isDeepSeek(a) ? 0 : 1;
    const bDeep = isDeepSeek(b) ? 0 : 1;
    if (aDeep !== bDeep) return aDeep - bDeep;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

export interface CodeMakerModelsDeps {
  home?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** When set, catalog requests are signed with the active CodeMaker session. */
  getCredentials?: () =>
    | CodeMakerCreds
    | null
    | Promise<CodeMakerCreds | null>;
}

export interface CodeMakerModelsLoader {
  /** Remote catalog or null on failure; memory + disk cached (5 min TTL). */
  list(): Promise<ModelInfo[] | null>;
}

export function createCodeMakerModelsLoader(
  deps: CodeMakerModelsDeps = {},
): CodeMakerModelsLoader {
  const now = deps.now ?? Date.now;
  let memory: { fetchedAt: number; models: ModelInfo[] } | null = null;
  let inflight: Promise<ModelInfo[] | null> | null = null;

  function readDisk(): { fetchedAt: number; models: ModelInfo[] } | null {
    if (!deps.home) return null;
    try {
      const file = getCodeMakerModelsCachePath(deps.home);
      if (!fs.existsSync(file)) return null;
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
        fetchedAt?: unknown;
        models?: unknown;
      };
      if (typeof raw.fetchedAt !== "number" || !Array.isArray(raw.models)) {
        return null;
      }
      return { fetchedAt: raw.fetchedAt, models: raw.models as ModelInfo[] };
    } catch {
      return null;
    }
  }

  function writeDisk(models: ModelInfo[]): void {
    if (!deps.home) return;
    try {
      const file = getCodeMakerModelsCachePath(deps.home);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        file,
        JSON.stringify({ fetchedAt: now(), models }, null, 2) + "\n",
        { encoding: "utf-8", mode: 0o600 },
      );
    } catch {
      // Cache is best-effort; ignore write failures.
    }
  }

  async function fetchRemote(): Promise<ModelInfo[] | null> {
    if (inflight) return inflight;
    inflight = (async () => {
      const fetchImpl = deps.fetch ?? fetch;
      try {
        const creds = deps.getCredentials
          ? await deps.getCredentials()
          : null;
        const doFetch = creds
          ? createCodeMakerFetch(creds, fetchImpl)
          : fetchImpl;
        const res = await doFetch(
          CODEMAKER_MODELS_API_URL,
          creds
            ? undefined
            : { headers: buildCodeMakerClientHeaders() },
        );
        if (!res.ok) return null;
        const payload = (await res.json()) as unknown;
        const models = parseRemoteModels(payload);
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
      if (memory && now() - memory.fetchedAt <= CODEMAKER_MODELS_CACHE_TTL_MS) {
        return memory.models;
      }
      const disk = readDisk();
      if (disk && now() - disk.fetchedAt <= CODEMAKER_MODELS_CACHE_TTL_MS) {
        memory = disk;
        return disk.models;
      }
      const remote = await fetchRemote();
      if (remote) {
        memory = { fetchedAt: now(), models: remote };
        writeDisk(remote);
        return remote;
      }
      // Soft-fail: keep serving the last good catalog rather than dropping to
      // the short bundled providers.json list when the gateway is briefly down.
      if (memory) return memory.models;
      if (disk) {
        memory = disk;
        return disk.models;
      }
      return null;
    },
  };
}
