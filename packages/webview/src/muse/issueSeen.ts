import { useSyncExternalStore } from "react";

const STORAGE_KEY = "muse.issue-seen.v1";

type SeenMap = Record<string, number>;

let seen: SeenMap = read();
const listeners = new Set<() => void>();
let listening = false;

function read(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: SeenMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function persist(next: SeenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can be unavailable in private windows; in-memory still works.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureListening(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    seen = read();
    emit();
  });
}

function update(next: SeenMap): void {
  seen = next;
  persist(next);
  emit();
}

export function useIssueSeen(): SeenMap {
  ensureListening();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => seen,
    () => seen,
  );
}

export function markIssueSeen(issueId: string, at = Date.now()): void {
  if (!issueId) return;
  const previous = seen[issueId] ?? 0;
  if (at <= previous) return;
  update({ ...seen, [issueId]: at });
}

export function markIssuesSeen(issueIds: readonly string[], at = Date.now()): void {
  if (issueIds.length === 0) return;
  const next = { ...seen };
  let changed = false;
  for (const issueId of issueIds) {
    if (!issueId) continue;
    if (at > (next[issueId] ?? 0)) {
      next[issueId] = at;
      changed = true;
    }
  }
  if (changed) update(next);
}

/** True when a progress update landed after the user last looked at this Issue. */
export function isIssueUpdateUnread(
  issueId: string,
  at: number | undefined,
  map: SeenMap = seen,
): boolean {
  return typeof at === "number" && at > (map[issueId] ?? 0);
}

export function resetIssueSeenForTests(): void {
  seen = {};
  listeners.clear();
  listening = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
