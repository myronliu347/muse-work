import { useSyncExternalStore } from "react";

export type DesktopUpdateOffer = {
  kind: "hot" | "installer";
  version: string;
};

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "failed"
  | "unavailable";

export type DesktopUpdateStatus = {
  phase: DesktopUpdatePhase;
  offer: DesktopUpdateOffer | null;
  detail?: string;
};

const IDLE: DesktopUpdateStatus = { phase: "idle", offer: null };

let current = IDLE;
const listeners = new Set<(status: DesktopUpdateStatus) => void>();

function isPhase(value: unknown): value is DesktopUpdatePhase {
  return (
    value === "idle" ||
    value === "checking" ||
    value === "available" ||
    value === "current" ||
    value === "failed" ||
    value === "unavailable"
  );
}

function readOffer(value: unknown): DesktopUpdateOffer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { kind?: unknown; version?: unknown };
  if ((row.kind !== "hot" && row.kind !== "installer") || typeof row.version !== "string") {
    return null;
  }
  return { kind: row.kind, version: row.version };
}

export function desktopUpdateStatus(): DesktopUpdateStatus {
  return current;
}

export function useDesktopUpdateStatus(): DesktopUpdateStatus {
  return useSyncExternalStore(subscribeDesktopUpdateStatus, desktopUpdateStatus, desktopUpdateStatus);
}

export function subscribeDesktopUpdateStatus(
  listener: (status: DesktopUpdateStatus) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyDesktopUpdateStatus(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const row = raw as { phase?: unknown; offer?: unknown; detail?: unknown };
  if (!isPhase(row.phase)) return;
  current = {
    phase: row.phase,
    offer: readOffer(row.offer),
    detail: typeof row.detail === "string" ? row.detail : undefined,
  };
  for (const listener of listeners) listener(current);
}

export function resetDesktopUpdateStatusForTests(): void {
  current = IDLE;
  for (const listener of listeners) listener(current);
}

export function updateStatusText(status: DesktopUpdateStatus): string {
  if (status.phase === "checking") return "正在检查…";
  if (status.phase === "current") return "已是最新版本";
  if (status.phase === "failed") {
    if (!status.detail || status.detail === "release has no hot assets" || status.detail.startsWith("HTTP 404")) {
      return "还没有新版本";
    }
    return `检查失败：${status.detail}`;
  }
  if (status.phase === "unavailable") return status.detail ?? "只有安装包会检查更新";
  if (status.phase === "available" && status.offer?.kind === "installer") {
    return `有新版本 ${status.offer.version}。侧栏底部的「更新」会打开安装包。`;
  }
  if (status.phase === "available" && status.offer) {
    return `有新版本 ${status.offer.version}。侧栏底部的「更新」会提示重启。`;
  }
  return "检查 GitHub Release 上有没有新版本。";
}

export function postDesktopCommand(command: "desktopCheckForUpdate" | "desktopApplyUpdate" | "desktopUpdateQuery"): void {
  if (typeof window.acquireVsCodeApi !== "function") return;
  window.acquireVsCodeApi().postMessage({ command });
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { command?: unknown } | null;
    if (data?.command !== "desktopUpdateStatus") return;
    applyDesktopUpdateStatus(data);
  });
}
