/**
 * Shared close-issue side effects.
 *
 * An issue owns its planning/execution sessions, so closing it drops them from
 * the session store. Both close paths — the HTTP route the UI calls and the
 * assistant's `CloseIssue` tool — must run the same cleanup; the tool used to
 * close straight through the store and leave its sessions behind.
 */
import type { Issue } from "./issueStore.js";
import type { SessionRunner } from "./sessionRunner/index.js";
import { getLogger } from "../utils/logger.js";

/** One-line timeline summary; the full Markdown note stays in detail. */
export function plainCloseSummary(note: string): string {
  const plain = note
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/[*_`>|#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 120) || "已完成";
}

/**
 * Delete the sessions an issue owns.
 *
 * The transcript files stay on disk for the regular retention sweep; only the
 * session records (and the live agents) are dropped, so the sessions stop
 * showing up in the sidebar and the workspace list.
 * @param runner - Session runner owning the live agents and the session store.
 * @param issue - Closed issue whose sessions should be dropped.
 */
export async function deleteIssueSessions(
  runner: Pick<SessionRunner, "disposeSession">,
  issue: Pick<Issue, "planningSessionId" | "executionSessionId">,
): Promise<void> {
  const ids = new Set(
    [issue.planningSessionId, issue.executionSessionId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  for (const id of ids) {
    try {
      await runner.disposeSession(id);
    } catch (err) {
      getLogger().error("issue session delete failed", {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
