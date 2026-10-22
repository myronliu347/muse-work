type PendingSearch = { workdir: string };

const latestByWorkdir = new Map<string, string>();
const pending = new Map<string, PendingSearch>();

export function noteDesktopContentSearchRequest(
  workdir: string,
  requestId: string,
): void {
  if (!requestId || !workdir) return;
  pending.set(requestId, { workdir });
  latestByWorkdir.set(workdir, requestId);
}

/**
 * Workdir that owns this reply. Null when `requestId` is unknown or a newer
 * search for the same directory has already been sent.
 */
export function acceptDesktopContentSearchResult(
  requestId: string,
): string | null {
  const noted = pending.get(requestId);
  if (!noted) return null;
  if (latestByWorkdir.get(noted.workdir) !== requestId) return null;
  return noted.workdir;
}

export function resetDesktopContentSearchRequests(): void {
  latestByWorkdir.clear();
  pending.clear();
}
