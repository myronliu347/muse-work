/** Normalize a workdir for prefix comparison: forward slashes, no trailing slash. */
export function normalizeWorkdirPath(value: string): string {
  const trimmed = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** True when `filePath` is the workdir itself or lives below it. */
export function isPathInsideWorkdir(
  filePath: string,
  workdir: string,
): boolean {
  const file = normalizeWorkdirPath(filePath);
  const root = normalizeWorkdirPath(workdir);
  if (root === "/") return file.startsWith("/");
  return file === root || file.startsWith(`${root}/`);
}

/**
 * Pick the workdir that owns an open file. Known dirs are the active issue
 * workdirs plus the host's recent workdirs; the most specific (longest) match
 * wins so nested worktrees do not resolve to their repo root.
 */
export function workdirForFile(
  filePath: string | null | undefined,
  workdirs: readonly (string | null | undefined)[],
): string | undefined {
  if (!filePath) return undefined;
  let best: string | undefined;
  let bestLength = -1;
  const seen = new Set<string>();
  for (const candidate of workdirs) {
    if (!candidate) continue;
    const normalized = normalizeWorkdirPath(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!isPathInsideWorkdir(filePath, normalized)) continue;
    if (normalized.length > bestLength) {
      // Return the caller's own spelling: it is the panel-group key.
      best = candidate;
      bestLength = normalized.length;
    }
  }
  return best;
}

/** Deduplicated workdir list, normalized, preserving order. */
export function uniqueWorkdirs(
  workdirs: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of workdirs) {
    if (!candidate) continue;
    const normalized = normalizeWorkdirPath(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
