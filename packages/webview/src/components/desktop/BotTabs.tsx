import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  closeIssueTab as applyCloseIssueTab,
  focusTab as applyFocusTab,
  initialBotWorkspace,
  openIssueSession as applyOpenIssueSession,
  selectPanel as applySelectPanel,
  type BotWorkspaceState,
  type PanelSelection,
} from "./botWorkspace";

export interface BotTabsProps {
  state: BotWorkspaceState;
  titles: Record<string, string>;
  onFocus: (tab: "bot" | string) => void;
  onClose: (issueId: string) => void;
}

export interface BotWorkspaceContextValue extends BotWorkspaceState {
  focusTab: (tab: "bot" | string) => void;
  closeIssueTab: (issueId: string) => void;
  openIssueSession: (issueId: string) => void;
  selectPanel: (panel: Exclude<PanelSelection, { kind: "none" }>) => void;
}

const BotWorkspaceContext = createContext<BotWorkspaceContextValue | null>(null);

export function BotWorkspaceProvider({
  value,
  children,
}: {
  value: BotWorkspaceContextValue;
  children: ReactNode;
}) {
  return (
    <BotWorkspaceContext.Provider value={value}>{children}</BotWorkspaceContext.Provider>
  );
}

export function useBotWorkspace(): BotWorkspaceContextValue | null {
  return useContext(BotWorkspaceContext);
}

/** Owns tab state. DesktopShell provides it; a pane-less ChatApp uses its own. */
export function useBotWorkspaceController(
  firstIssueId: string | null,
): BotWorkspaceContextValue {
  const [state, setState] = useState(() => initialBotWorkspace(firstIssueId));
  const seededIssue = useRef(firstIssueId != null);
  useEffect(() => {
    if (!firstIssueId || seededIssue.current) return;
    seededIssue.current = true;
    setState((current) => {
      if (
        current.lastIssueId ||
        current.openIssueIds.length > 0 ||
        current.panel.kind !== "none"
      ) {
        return current;
      }
      return initialBotWorkspace(firstIssueId);
    });
  }, [firstIssueId]);
  const focusTab = useCallback((tab: "bot" | string) => {
    setState((current) => applyFocusTab(current, tab));
  }, []);
  const closeIssueTab = useCallback((issueId: string) => {
    setState((current) => applyCloseIssueTab(current, issueId));
  }, []);
  const openIssueSession = useCallback((issueId: string) => {
    setState((current) => applyOpenIssueSession(current, issueId));
  }, []);
  const selectPanel = useCallback(
    (panel: Exclude<PanelSelection, { kind: "none" }>) => {
      setState((current) => applySelectPanel(current, panel));
    },
    [],
  );
  return useMemo(
    () => ({
      ...state,
      focusTab,
      closeIssueTab,
      openIssueSession,
      selectPanel,
    }),
    [state, focusTab, closeIssueTab, openIssueSession, selectPanel],
  );
}

function tabClass(active: boolean): string {
  return active ? "bot-tab active" : "bot-tab";
}

export function BotTabs({ state, titles, onFocus, onClose }: BotTabsProps) {
  const tabs = ["bot", ...state.openIssueIds];
  return (
    <div className="bot-tabs" aria-label="Muse Bot">
      {tabs.map((tab) => {
        const active = state.active === tab;
        if (tab === "bot") {
          return (
            <button
              key="bot"
              type="button"
              className={tabClass(active)}
              onClick={() => onFocus("bot")}
            >
              Muse Bot
            </button>
          );
        }
        const title = titles[tab] ?? tab;
        return (
          <span key={tab} className={active ? "bot-tab-group active" : "bot-tab-group"}>
            <button
              type="button"
              className={tabClass(active)}
              onClick={() => onFocus(tab)}
            >
              <span className="bot-tab-label">{title}</span>
            </button>
            <button
              type="button"
              className="bot-tab-close"
              aria-label="关闭"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
