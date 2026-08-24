import {
  useCallback,
  useEffect,
  type MutableRefObject,
} from "react";
import type { VsCodeApi } from "../types";
import {
  patchPaneUi,
  usePanelGroupStore,
  type PanelGroupState,
  type PaneUiSlice,
} from "../stores";

/** Core host bridge + pane/group patches shared by every domain hook. */
export interface ChatAppCore {
  postToHost: (message: Record<string, unknown>) => void;
  patchPane: (
    patch:
      | Partial<PaneUiSlice>
      | ((slice: PaneUiSlice) => Partial<PaneUiSlice>),
  ) => void;
  updatePanelGroup: (
    patch:
      | Partial<PanelGroupState>
      | ((group: PanelGroupState) => Partial<PanelGroupState>),
  ) => void;
  requestPaneGitBranches: (opts?: { clear?: boolean }) => void;
}

interface UseChatAppCoreParams {
  paneId?: string;
  vscode: VsCodeApi;
  effectiveWorkdir?: string;
  groupKey?: string;
  paneIdRef: MutableRefObject<string | undefined>;
}

export function useChatAppCore({
  paneId,
  vscode,
  effectiveWorkdir,
  groupKey,
  paneIdRef,
}: UseChatAppCoreParams): ChatAppCore {
  const patchPane = useCallback(
    (
      patch:
        | Partial<PaneUiSlice>
        | ((slice: PaneUiSlice) => Partial<PaneUiSlice>),
    ) => {
      patchPaneUi(paneId, patch);
    },
    [paneId],
  );

  const updatePanelGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      if (!groupKey) return;
      usePanelGroupStore.getState().patchGroup(groupKey, patch);
    },
    [groupKey],
  );

  // Desktop multi-pane (FR-032): session-scoped commands carry this pane's id
  // so the host routes them to the agent bound to this pane. Untagged when
  // paneId is undefined (single view) — the host ignores the field.
  const postToHost = useCallback(
    (message: Record<string, unknown>) => {
      const pid = paneIdRef.current;
      vscode.postMessage(
        pid === undefined ? message : { ...message, paneId: pid },
      );
    },
    [vscode],
  );

  // Desktop: query this pane's own workdir for its git branches (FR-052). Each
  // pane asks independently so a new-session pane keeps its workdir/branch even
  // when focus moves to a sibling pane (which would otherwise rewire the host's
  // global workdir). Clear stale branches first so the selector hides until the
  // fresh reply lands.
  //
  // Depend ONLY on effectiveWorkdir (a primitive string) — never on the host
  // object reference, and never on host.workdir. Rationale: when a new pane
  // boots, activateAgentInPane sends desktopWorkdirState to update the host's
  // global workdir from the previously-focused sibling's path to this pane's
  // repo root. That changes host.workdir even though THIS pane's
  // effectiveWorkdir is unchanged (spawn-before = recents[0] fallback; spawn-after
  // = state.workdir = agent.cwd = the same recents[0]). Re-querying on a
  // host.workdir change would null out the branches and flash the selector
  // twice. A genuine user workdir switch changes recents[0] (and thus
  // effectiveWorkdir), which is the only re-query signal we want.
  const GIT_BRANCH_POLL_MS = 3000;

  const requestPaneGitBranches = useCallback(
    (opts?: { clear?: boolean }) => {
      if (!effectiveWorkdir) {
        if (opts?.clear) patchPane({ paneGitBranches: null });
        return;
      }
      if (opts?.clear) patchPane({ paneGitBranches: null });
      postToHost({
        command: "desktopListGitBranches",
        workdir: effectiveWorkdir,
        paneId,
      });
    },
    [effectiveWorkdir, paneId, patchPane, postToHost],
  );

  // workdir change: clear then fetch (existing semantics)
  useEffect(() => {
    requestPaneGitBranches({ clear: true });
  }, [requestPaneGitBranches]);

  // poll + resume on visibility (silent refresh — do not clear)
  useEffect(() => {
    if (!effectiveWorkdir) return;

    const poll = () => {
      if (document.visibilityState === "hidden") return;
      requestPaneGitBranches();
    };

    const id = window.setInterval(poll, GIT_BRANCH_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        requestPaneGitBranches();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [effectiveWorkdir, requestPaneGitBranches]);

  return { postToHost, patchPane, updatePanelGroup, requestPaneGitBranches };
}
