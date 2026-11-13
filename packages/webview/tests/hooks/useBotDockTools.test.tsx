/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotWorkspaceContextValue } from "../../src/components/desktop/BotTabs";
import { useBotDockTools } from "../../src/hooks/useBotDockTools";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  usePanelGroupStore,
  type DockToolInstance,
} from "../../src/stores";
import type { VsCodeApi } from "../../src/types";

function setup(dockWorkdir: string | undefined) {
  const postMessage = vi.fn();
  const selectDock = vi.fn();
  const setAssistantDockOpen = vi.fn();
  const vscode = { postMessage } as unknown as VsCodeApi;
  const { result } = renderHook(() =>
    useBotDockTools({
      assistantVisible: true,
      workspace: {} as BotWorkspaceContextValue,
      chromeChecked: [],
      activePanel: "terminal",
      shownFileTabs: [],
      shownActiveFilePath: null,
      assistantActiveToolId: null,
      assistantTools: [],
      slotCheckedWithFile: [],
      groupKey: ASSISTANT_PANEL_GROUP_KEY,
      selectDockRef: { current: selectDock },
      dockWorkdirRef: { current: dockWorkdir },
      vscodeRef: { current: vscode },
      dockChromeRef: { current: "terminal" },
      assistantVisibleRef: { current: true },
      dockIssueIdRef: { current: undefined },
      onSessionsSurface: false,
      groupKeyRef: { current: ASSISTANT_PANEL_GROUP_KEY },
      setAssistantDockOpen,
    }),
  );
  return { result, postMessage, selectDock, setAssistantDockOpen };
}

const OLD_WORKDIR = "/work/quiet-river-739";

function seedTerminal(): DockToolInstance {
  usePanelGroupStore.getState().reset();
  const tool: DockToolInstance = {
    id: "t1",
    kind: "terminal",
    workdir: OLD_WORKDIR,
  };
  usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
    tools: [tool],
    activeToolId: "t1",
    tabOrder: ["detail", "tool:t1", "kind:diff"],
  });
  return tool;
}

describe("useBotDockTools.restartBotTerminal", () => {
  beforeEach(() => {
    usePanelGroupStore.getState().reset();
  });

  it("kills the old PTY and rebuilds the tab at the current dock workdir", () => {
    seedTerminal();
    const { result, postMessage, selectDock } = setup("/work/issue-42");
    act(() => result.current.restartBotTerminal("t1"));

    expect(postMessage).toHaveBeenCalledWith({
      command: "desktopTerminalKill",
      termId: "bot-term-t1",
    });

    const group = usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY];
    expect(group.tools).toHaveLength(1);
    const rebuilt = group.tools[0];
    expect(rebuilt.kind).toBe("terminal");
    expect(rebuilt.workdir).toBe("/work/issue-42");
    // New id ⇒ fresh PTY; the old one is dead and must not be reattached.
    expect(rebuilt.id).not.toBe("t1");
    expect(group.activeToolId).toBe(rebuilt.id);
    expect(group.tabOrder).toEqual(["detail", `tool:${rebuilt.id}`, "kind:diff"]);
    expect(selectDock).toHaveBeenCalledWith("terminal");
  });

  it("keeps the old directory when the dock has no workdir", () => {
    seedTerminal();
    const { result } = setup(undefined);
    act(() => result.current.restartBotTerminal("t1"));

    const group = usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY];
    expect(group.tools[0].workdir).toBe(OLD_WORKDIR);
  });

  it("ignores ids that are not terminal tabs", () => {
    seedTerminal();
    const { result, postMessage } = setup("/work/issue-42");
    act(() => result.current.restartBotTerminal("missing"));

    expect(postMessage).not.toHaveBeenCalled();
    expect(
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY].tools,
    ).toEqual([{ id: "t1", kind: "terminal", workdir: OLD_WORKDIR }]);
  });
});
