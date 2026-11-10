import { useCallback, type MutableRefObject } from "react";
import { activePreviewTool, patchDockTool } from "../muse/dockTools";
import { filesReferToSame } from "../muse/fileTabs";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  issueFileGroupKey,
  resolvePanelGroup,
  usePanelGroupStore,
  type PanelGroupState,
} from "../stores";

/**
 * Writes preview and file-tab state onto the group the dock is actually
 * showing. On Muse Bot that is the assistant bar, not the issue directory.
 */
export function usePanelGroupWriters({
  assistantVisibleRef,
  previewGroupKeyRef,
  shownIssueIdRef,
  dockIssueIdRef,
}: {
  assistantVisibleRef: MutableRefObject<boolean>;
  previewGroupKeyRef: MutableRefObject<string | undefined>;
  shownIssueIdRef: MutableRefObject<string | undefined>;
  dockIssueIdRef: MutableRefObject<string | null | undefined>;
}) {
  const updatePreviewGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      if (assistantVisibleRef.current) {
        const store = usePanelGroupStore.getState();
        const group = resolvePanelGroup(store.groups, ASSISTANT_PANEL_GROUP_KEY);
        const resolved = typeof patch === "function" ? patch(group) : patch;
        const touchesPreview =
          "previewUrl" in resolved ||
          "forward" in resolved ||
          "forwardError" in resolved;
        const target = activePreviewTool(group.tools ?? [], group.activeToolId);
        if (touchesPreview && target) {
          store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
            tools: patchDockTool(group.tools ?? [], target.id, {
              ...("previewUrl" in resolved ? { previewUrl: resolved.previewUrl } : {}),
              ...("forward" in resolved ? { forward: resolved.forward } : {}),
              ...("forwardError" in resolved
                ? { forwardError: resolved.forwardError }
                : {}),
            }),
          });
          return;
        }
      }
      const key = previewGroupKeyRef.current;
      if (!key) return;
      usePanelGroupStore.getState().patchGroup(key, patch);
    },
    [],
  );
  const updateFileGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      const store = usePanelGroupStore.getState();
      if (!assistantVisibleRef.current) {
        const key = previewGroupKeyRef.current;
        if (!key) return;
        store.patchGroup(key, patch);
        return;
      }
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, patch);
      const issueKey = previewGroupKeyRef.current;
      if (issueKey && issueKey !== ASSISTANT_PANEL_GROUP_KEY) {
        store.patchGroup(issueKey, { activeFilePath: null });
      }
      const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
      if (ownedId) {
        store.patchGroup(issueFileGroupKey(ownedId), { activeFilePath: null });
      }
    },
    [],
  );
  const resolveFileGroupKey = useCallback((path: string) => {
    if (!assistantVisibleRef.current) return undefined;
    const store = usePanelGroupStore.getState();
    const ownedId = shownIssueIdRef.current ?? dockIssueIdRef.current;
    const issueKey = ownedId ? issueFileGroupKey(ownedId) : undefined;
    const onAssistant = (store.groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs ?? []).some(
      (tab) => filesReferToSame(tab, { path }),
    );
    const onIssue = Boolean(
      issueKey &&
        (store.groups[issueKey]?.fileTabs ?? []).some((tab) =>
          filesReferToSame(tab, { path }),
        ),
    );
    if (onIssue && !onAssistant) return issueKey;
    return ASSISTANT_PANEL_GROUP_KEY;
  }, []);

  return { updatePreviewGroup, updateFileGroup, resolveFileGroupKey };
}
