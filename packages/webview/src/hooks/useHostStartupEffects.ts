import { useEffect, useRef, type MutableRefObject } from "react";
import { takeRestoredFileLoads } from "../muse/botPageState";
import { ASSISTANT_PANEL_GROUP_KEY } from "../stores";
import type { ChatAppCore } from "./useChatAppCore";
import type { DesktopHostProps } from "../types";

/**
 * One-shot host wiring after the bridge exists: reopen files from the last
 * page, clear issue unread, drop the queue-edit toast, and forget a worktree
 * pick when the directory actually changes.
 */
export function useHostStartupEffects({
  postToHost,
  host,
  workspaceActive,
  clearIssueUnreadRef,
  queueEditWarning,
  patchPane,
  effectiveWorkdir,
}: {
  postToHost: ChatAppCore["postToHost"];
  host: DesktopHostProps | undefined;
  workspaceActive: string;
  clearIssueUnreadRef: MutableRefObject<(issueId: string) => void>;
  queueEditWarning: string | null;
  patchPane: ChatAppCore["patchPane"];
  effectiveWorkdir: string | undefined;
}) {
  useEffect(() => {
    const loads = takeRestoredFileLoads();
    for (const item of loads) {
      postToHost({
        command: "openFile",
        path: item.path,
        host: item.host,
        // The reply must land on this group's tabs. At startup the visible
        // preview group is often still the assistant key, because the issue
        // list has not arrived yet. "assistant" is the bot file bar, not a
        // directory: an absolute path still reads, and a relative one falls
        // back to the app workdir.
        ...(item.workdir === ASSISTANT_PANEL_GROUP_KEY
          ? {}
          : { workdir: item.workdir }),
        fileGroupKey: item.workdir,
      });
    }
  }, [postToHost]);
  useEffect(() => {
    clearIssueUnreadRef.current = (issueId: string) => {
      const group = (host?.issueGroups ?? []).find((item) => item.issueId === issueId);
      const sessionIds = (group?.sessions ?? [])
        .filter((item) => item.unreadDone && item.sessionId)
        .map((item) => item.sessionId);
      if (sessionIds.length === 0) return;
      postToHost({ command: "desktopClearUnread", sessionIds });
    };
  }, [host?.issueGroups, postToHost, clearIssueUnreadRef]);
  useEffect(() => {
    if (workspaceActive === "bot") return;
    clearIssueUnreadRef.current(workspaceActive);
  }, [workspaceActive, host?.issueGroups, clearIssueUnreadRef]);
  useEffect(() => {
    if (!queueEditWarning) return;
    const timer = setTimeout(() => patchPane({ queueEditWarning: null }), 4000);
    return () => clearTimeout(timer);
  }, [queueEditWarning, patchPane]);
  // Reset the worktree opt-in only when the workdir path actually changes.
  // Do not depend on gitBranches (poll rewrites it) or treat patchPane
  // identity changes as a workdir switch.
  const prevWorkdirRef = useRef(effectiveWorkdir);
  useEffect(() => {
    const prev = prevWorkdirRef.current;
    prevWorkdirRef.current = effectiveWorkdir;
    if (prev === effectiveWorkdir) return;
    patchPane({
      worktreeBranch: "",
      worktreeChecked: false,
    });
  }, [effectiveWorkdir, patchPane]);
}
