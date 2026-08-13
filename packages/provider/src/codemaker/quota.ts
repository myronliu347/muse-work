import { CODEMAKER_BASE_URL } from "./provider.js";
import { createCodeMakerFetch } from "./sign.js";
import type { CodeMakerCreds } from "./types.js";

/** Matches CodeMaker Hub / CLI: global user quota usage. */
export const CODEMAKER_USER_QUOTA_USAGE_PATH =
  "/api/v1/user_quota/usage?quota_type=global";

export interface CodeMakerQuotaUsage {
  /** Raw JSON from the API (shape may evolve). */
  raw: unknown;
  user?: string;
  /** Best-effort normalized fields for UI (from current_month when present). */
  total?: number;
  used?: number;
  remaining?: number;
  /** Usage percent as reported by API (e.g. 0.07 means 0.07%). */
  percentage?: number;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickData(raw: unknown): Record<string, unknown> {
  const root = asRecord(raw) ?? {};
  const nested = asRecord(root.data);
  return nested ?? root;
}

/** Prefer CodeMaker's monthly quota bucket (`current_month` / `current_Month`). */
function pickMonthBucket(data: Record<string, unknown>): Record<string, unknown> {
  const month =
    asRecord(data.current_month) ??
    asRecord(data.current_Month) ??
    asRecord(data.CurrentMonth);
  return month ?? data;
}

/** Normalize CodeMaker quota usage for UI. */
export function normalizeQuotaUsage(raw: unknown): CodeMakerQuotaUsage {
  const data = pickData(raw);
  const month = pickMonthBucket(data);

  const used =
    asNumber(month.usage_cost) ??
    asNumber(month.used) ??
    asNumber(month.usage) ??
    asNumber(month.used_quota) ??
    asNumber(month.consumed);
  let remaining =
    asNumber(month.remaining) ??
    asNumber(month.remain) ??
    asNumber(month.left) ??
    asNumber(month.available);
  let total =
    asNumber(month.total) ??
    asNumber(month.quota) ??
    asNumber(month.total_quota) ??
    asNumber(month.limit) ??
    asNumber(month.budget);
  if (total === undefined && used !== undefined && remaining !== undefined) {
    total = used + remaining;
  }
  if (remaining === undefined && total !== undefined && used !== undefined) {
    remaining = Math.max(0, total - used);
  }

  let percentage = asNumber(month.percentage);
  if (
    percentage === undefined &&
    total !== undefined &&
    total > 0 &&
    used !== undefined
  ) {
    percentage = (used / total) * 100;
  }

  const user =
    typeof data.user === "string"
      ? data.user
      : typeof data.access_user === "string"
        ? data.access_user
        : typeof data.username === "string"
          ? data.username
          : undefined;

  return { raw, user, total, used, remaining, percentage };
}

export async function fetchCodeMakerQuotaUsage(opts: {
  creds: CodeMakerCreds;
  fetch?: typeof fetch;
  baseUrl?: string;
}): Promise<CodeMakerQuotaUsage> {
  const baseUrl = opts.baseUrl ?? CODEMAKER_BASE_URL;
  const signedFetch = createCodeMakerFetch(opts.creds, opts.fetch ?? fetch);
  const res = await signedFetch(`${baseUrl}${CODEMAKER_USER_QUOTA_USAGE_PATH}`);
  if (!res.ok) {
    throw new Error(`CodeMaker quota fetch failed (${res.status})`);
  }
  const raw: unknown = await res.json();
  return normalizeQuotaUsage(raw);
}
