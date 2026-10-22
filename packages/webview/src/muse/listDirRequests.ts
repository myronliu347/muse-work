type PendingListDir = { workdir: string; dir: string };

const latestByDir = new Map<string, string>();
const pending = new Map<string, PendingListDir>();

function dirKey(workdir: string, dir: string): string {
  return `${workdir}\0${dir}`;
}

export function noteDesktopListDirRequest(
  workdir: string,
  dir: string,
  requestId: string,
): void {
  if (!requestId) return;
  pending.set(requestId, { workdir, dir });
  latestByDir.set(dirKey(workdir, dir), requestId);
}

/**
 * Workdir that owns this reply. Null when `requestId` is unknown or a newer
 * listing for the same directory has already been sent.
 */
export function acceptDesktopListDirResult(
  requestId: string,
  dir: string,
): string | null {
  const noted = pending.get(requestId);
  if (!noted || noted.dir !== dir) return null;
  if (latestByDir.get(dirKey(noted.workdir, noted.dir)) !== requestId) {
    return null;
  }
  return noted.workdir;
}

export function resetDesktopListDirRequests(): void {
  latestByDir.clear();
  pending.clear();
}
