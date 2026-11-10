import type { MessageRouteContext } from "./context";
import { acceptDesktopContentSearchResult } from "../contentSearchRequests";
import { acceptDesktopListDirResult } from "../listDirRequests";
import { emptyFileTreeState, patchPaneUi, usePanelGroupStore } from "../../stores";
import { applyCloseFileTab } from "../../stores/panelGroupStore";
import { patchDockTool } from "../dockTools";
import { upsertFileContentTab, closeFileTab } from "../fileTabs";
import type {
  ContentSearchFileHit,
  DesktopPanelKind,
  FileTreeDirEntry,
  FileViewState,
} from "../../types";

export function routePanels(message: any, ctx: MessageRouteContext): boolean {
  const { fileContentGroupKeyRef, previewGroupKeyRef, openQuickOpenRef, messageListRef, togglePanelRef, previewUrlRef, forThisPane, groupKeyRef, myPane } = ctx;
  switch (message.command) {
      case "desktopGitBranches":
        // Per-pane branch list reply (FR-052). Routed by paneId so a sibling
        // pane's reply never overwrites this pane's selector.
        if (!forThisPane(message)) break;
        patchPaneUi(myPane, { paneGitBranches: message.result ?? null });
        break;
      case "desktopForwardPortResult":
        // Remote preview port-forward reply (scenario 15/16). The forward is
        // session-scoped, so the reply is matched against the session whose
        // cached forward carries this requestId — a reply that lands after
        // the pane rebinds to another session still updates the owning
        // session's cached URL instead of being dropped.
        if (!forThisPane(message)) break;
        {
          const targetKey = usePanelGroupStore
            .getState()
            .findGroupKeyByForwardRequestId(message.requestId);
          if (targetKey === undefined) break;
          const owner = usePanelGroupStore.getState().groups[targetKey];
          const tool = owner?.tools?.find(
            (item) => item.forward?.requestId === message.requestId,
          );
          if (tool) {
            const url = typeof message.url === "string" ? message.url : "";
            usePanelGroupStore.getState().patchGroup(targetKey, {
              tools: patchDockTool(owner?.tools ?? [], tool.id, message.error
                ? { forwardError: String(message.error) }
                : {
                    forwardError: null,
                    previewUrl: url,
                    epoch: url === tool.previewUrl ? (tool.epoch ?? 0) + 1 : tool.epoch ?? 0,
                  }),
            });
            break;
          }
          if (message.error) {
            usePanelGroupStore.getState().patchGroup(targetKey, {
              forwardError: String(message.error),
            });
          } else {
            usePanelGroupStore.getState().patchGroup(targetKey, {
              forwardError: null,
              previewUrl: message.url as string,
            });
            if (
              message.url === previewUrlRef.current &&
              (targetKey === groupKeyRef.current ||
                targetKey === previewGroupKeyRef.current)
            ) {
              // Same URL as before (re-acquire after a guest load failure):
              // remount so the webview actually reloads instead of the [url]
              // effect early-returning on an unchanged prop.
              usePanelGroupStore.getState().bumpPreviewEpoch(targetKey);
            }
          }
        }
        break;
      case "desktopFileContent":
        // File panel content reply (file panel spec scenario 1/2). Routed by
        // paneId so a sibling pane's reply never overwrites this pane's view.
        // Multi-tab: fill the tab for this path (keeping its pin state and
        // position), or build one and activate it when no tab exists.
        if (!forThisPane(message)) break;
        {
          const routed =
            typeof message.fileGroupKey === "string" && message.fileGroupKey
              ? message.fileGroupKey
              : undefined;
          const key =
            routed ||
            fileContentGroupKeyRef?.current ||
            previewGroupKeyRef.current ||
            groupKeyRef.current;
          if (key) {
            const incoming = message.fileView as FileViewState;
            const requestedPath =
              typeof message.requestedPath === "string"
                ? message.requestedPath
                : undefined;
            // A click opens a loading tab before the host can stat the path.
            // When the file is not on disk, drop that tab (and the file panel
            // if it was the only one). The host toast is the only feedback.
            if (
              typeof incoming?.error === "string" &&
              incoming.error.includes("文件不存在")
            ) {
              const paths = [requestedPath, incoming.path].filter(
                (p): p is string => typeof p === "string" && p.length > 0,
              );
              usePanelGroupStore.getState().patchGroup(key, (group) => {
                const tabs = group.fileTabs ?? [];
                const hit = paths.find((p) =>
                  tabs.some((t) => t.path === p || t.tabKey === p),
                );
                if (!hit) return {};
                return applyCloseFileTab(group, hit);
              });
              break;
            }
            usePanelGroupStore.getState().patchGroup(key, (group) =>
              upsertFileContentTab(
                {
                  fileTabs: group.fileTabs ?? [],
                  activeFilePath: group.activeFilePath ?? null,
                },
                incoming,
                requestedPath,
              ),
            );
          }
        }
        break;
      case "openQuickOpen":
        if (!forThisPane(message)) break;
        {
          const routed =
            typeof message.fileGroupKey === "string" && message.fileGroupKey
              ? message.fileGroupKey
              : undefined;
          const key =
            routed ||
            fileContentGroupKeyRef?.current ||
            previewGroupKeyRef.current ||
            groupKeyRef.current;
          const closePath = typeof message.path === "string" ? message.path : "";
          if (key && closePath) {
            usePanelGroupStore.getState().patchGroup(key, (group) =>
              closeFileTab(
                {
                  fileTabs: group.fileTabs ?? [],
                  activeFilePath: group.activeFilePath ?? null,
                },
                closePath,
              ),
            );
          }
          const query = typeof message.query === "string" ? message.query : "";
          openQuickOpenRef.current(query);
        }
        break;
      case "desktopListDirResult": {
        const cacheDir = typeof message.dir === "string" ? message.dir : "";
        const requestId =
          typeof message.requestId === "string" ? message.requestId : "";
        const notedWorkdir = requestId
          ? acceptDesktopListDirResult(requestId, cacheDir)
          : undefined;
        if (requestId && !notedWorkdir) break;
        const key =
          notedWorkdir || previewGroupKeyRef.current || groupKeyRef.current;
        if (!key) break;
        const entries = Array.isArray(message.entries)
          ? (message.entries as FileTreeDirEntry[])
          : [];
        usePanelGroupStore.getState().patchGroup(key, (group) => ({
          fileTree: {
            ...(group.fileTree ?? emptyFileTreeState()),
            childrenCache: {
              ...(group.fileTree?.childrenCache ?? {}),
              [cacheDir]: entries,
            },
          },
        }));
        break;
      }
      case "desktopSearchContentResult": {
        const requestId =
          typeof message.requestId === "string" ? message.requestId : "";
        const notedWorkdir = requestId
          ? acceptDesktopContentSearchResult(requestId)
          : undefined;
        if (requestId && !notedWorkdir) break;
        const key =
          notedWorkdir || previewGroupKeyRef.current || groupKeyRef.current;
        if (!key) break;
        usePanelGroupStore.getState().patchGroup(key, (group) => {
          if (
            requestId &&
            (!group.contentSearch?.requestId ||
              group.contentSearch.requestId !== requestId)
          ) {
            return {};
          }
          return {
            contentSearch: {
              ...group.contentSearch,
              loading: false,
              results: Array.isArray(message.results)
                ? (message.results as ContentSearchFileHit[])
                : [],
              expandedFiles: Array.isArray(message.results)
                ? (message.results as ContentSearchFileHit[]).map(
                    (r) => r.relativePath,
                  )
                : [],
              truncated: Boolean(message.truncated) || undefined,
              error:
                typeof message.error === "string"
                  ? message.error
                  : undefined,
            },
          };
        });
        break;
      }
      case "desktopThemeChange":
        break;
      case "desktopTogglePanel":
        if (!forThisPane(message)) break;
        togglePanelRef.current(message.kind as DesktopPanelKind);
        break;
      case "scrollToBottom":
        if (!forThisPane(message)) break;
        // Scroll the message list to bottom
        if (
          messageListRef.current &&
          typeof messageListRef.current.scrollToBottom === "function"
        ) {
          messageListRef.current.scrollToBottom("auto");
        }
        break;
    default:
      return false;
  }
  return true;
}
