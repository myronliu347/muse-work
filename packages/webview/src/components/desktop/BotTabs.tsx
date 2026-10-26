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
import { IssuePresenceMark, type IssuePresence } from "../session/SessionStatusGlyph";
import { Tooltip } from "../shared/Tooltip";
import {
  closeIssueTab as applyCloseIssueTab,
  focusTab as applyFocusTab,
  initialBotWorkspace,
  openIssueSession as applyOpenIssueSession,
  selectDock as applySelectDock,
  selectPanel as applySelectPanel,
  type BotWorkspaceState,
  type DockChrome,
  type PanelSelection,
} from "./botWorkspace";

export interface BotTabsProps {
  state: BotWorkspaceState;
  titles: Record<string, string>;
  presence?: Record<string, IssuePresence | null>;
  onFocus: (tab: "bot" | string) => void;
  onClose: (issueId: string) => void;
}

export interface BotWorkspaceContextValue extends BotWorkspaceState {
  focusTab: (tab: "bot" | string) => void;
  closeIssueTab: (issueId: string) => void;
  openIssueSession: (issueId: string) => void;
  selectPanel: (panel: Exclude<PanelSelection, { kind: "none" }>) => void;
  selectDock: (dock: DockChrome) => void;
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

/** Owns tab state for one running app. Mount this only in the child that exists when nothing else owns the workspace. */
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
  const selectDock = useCallback((dock: DockChrome) => {
    setState((current) => applySelectDock(current, dock));
  }, []);
  return useMemo(
    () => ({
      ...state,
      focusTab,
      closeIssueTab,
      openIssueSession,
      selectPanel,
      selectDock,
    }),
    [state, focusTab, closeIssueTab, openIssueSession, selectPanel, selectDock],
  );
}

function scrollTabIntoView(container: HTMLElement, tab: HTMLElement) {
  const root = container.getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  const gap = 4;
  if (box.left < root.left + gap) {
    container.scrollLeft -= root.left + gap - box.left;
  } else if (box.right > root.right - gap) {
    container.scrollLeft += box.right - (root.right - gap);
  }
}

function tabClass(active: boolean): string {
  return active ? "bot-tab active" : "bot-tab";
}

export function BotTabs({ state, titles, presence, onFocus, onClose }: BotTabsProps) {
  const tabs = ["bot", ...state.openIssueIds];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reveal = useCallback((tab: "bot" | string) => {
    onFocus(tab);
    const root = scrollerRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-bot-tab="${CSS.escape(tab)}"]`);
    if (root && el) scrollTabIntoView(root, el);
  }, [onFocus]);
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-bot-tab="${CSS.escape(state.active)}"]`,
    );
    if (el) scrollTabIntoView(root, el);
  }, [state.active, state.openIssueIds]);
  return (
    <div className="bot-tabs" aria-label="Muse Bot" ref={scrollerRef}>
      {tabs.map((tab) => {
        const active = state.active === tab;
        if (tab === "bot") {
          return (
            <button
              key="bot"
              type="button"
              data-bot-tab="bot"
              className={tabClass(active)}
              onClick={() => reveal("bot")}
            >
              Muse Bot
            </button>
          );
        }
        const title = titles[tab] ?? tab;
        return (
          <Tooltip key={tab} text={title} position="bottom" wrap={false} className="bot-tab-tip">
            <span
              data-bot-tab={tab}
              className={active ? "bot-tab-group active" : "bot-tab-group"}
            >
              <button
                type="button"
                className={tabClass(active)}
                onClick={() => reveal(tab)}
              >
                {presence?.[tab] ? (
                  <span className="bot-tab-status" aria-hidden="true">
                    <IssuePresenceMark presence={presence[tab]} />
                  </span>
                ) : null}
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
          </Tooltip>
        );
      })}
    </div>
  );
}
