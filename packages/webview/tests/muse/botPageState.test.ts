/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  BOT_PAGE_STATE_KEY,
  captureBotPanels,
  loadBotPageSnapshot,
  panelPatchesFromSnapshot,
  pruneBotWorkspace,
  readInitialBotWorkspace,
  resetBotPagePersistence,
  takeRestoredFileLoads,
  type BotPageSnapshot,
} from "../../src/muse/botPageState";
import { emptyPanelGroup } from "../../src/stores/panelGroupStore";
import type { PanelGroupState } from "../../src/stores/panelGroupStore";
import { initialBotWorkspace } from "../../src/components/desktop/botWorkspace";

function group(patch: Partial<PanelGroupState>): PanelGroupState {
  return { ...emptyPanelGroup(), ...patch };
}

afterEach(() => {
  resetBotPagePersistence();
});

describe("bot page persistence", () => {
  it("keeps layout and drops file contents, forwards, and terminals without a directory", () => {
    const captured = captureBotPanels({
      assistant: group({
        dockColumnOpen: true,
        widths: { preview: 500, diff: 500, terminal: 500, file: 500 },
        tabOrder: ["detail", "kind:diff", "tool:term-1"],
        activeToolId: "term-1",
        tools: [
          { id: "term-1", kind: "terminal", workdir: "/work/radii" },
          { id: "term-empty", kind: "terminal" },
          {
            id: "browser-1",
            kind: "preview",
            previewUrl: "https://example.test",
            pageTitle: "Example",
            forward: { host: "remote", remotePort: 1, originalUrl: "http://x", requestId: "r" },
          },
        ],
      }),
      "/work/radii": group({
        checked: ["file", "diff", "terminal"],
        active: "file",
        fileTabs: [
          { path: "/work/radii/App.tsx", host: "local", content: "secret", pinned: true },
        ],
        activeFilePath: "/work/radii/App.tsx",
      }),
      "/work/session-only": group({
        checked: ["terminal"],
        active: "terminal",
      }),
    });

    expect(captured.assistant?.dockColumnOpen).toBe(true);
    expect(captured.assistant?.tools.map((tool) => tool.id)).toEqual(["term-1", "browser-1"]);
    expect(captured.assistant?.tools[1]).toMatchObject({
      id: "browser-1",
      previewUrl: "https://example.test",
      pageTitle: "Example",
    });
    expect(captured.assistant?.tools[1]).not.toHaveProperty("forward");
    const restored = panelPatchesFromSnapshot({
      version: 1,
      workspace: null,
      assistant: captured.assistant,
      directories: {},
    });
    expect(restored.assistant?.tools?.[1]).toMatchObject({ pageTitle: "Example" });
    expect(captured.directories["/work/radii"]?.checked).toEqual(["file", "diff"]);
    expect(captured.directories["/work/radii"]?.fileTabs).toEqual([
      { path: "/work/radii/App.tsx", host: "local", pinned: true },
    ]);
    expect(captured.directories["/work/session-only"]).toBeUndefined();
  });

  it("restores the saved issue and reloads file tabs without their old content", () => {
    const snapshot: BotPageSnapshot = {
      version: 1,
      workspace: {
        active: "radii",
        openIssueIds: ["radii", "gone"],
        panel: { kind: "issue", issueId: "radii" },
        dock: "diff",
        docks: { radii: "diff" },
        lastIssueId: "radii",
      },
      assistant: {
        dockColumnOpen: true,
        widths: { preview: 480, diff: 480, terminal: 480, file: 480 },
        tabOrder: ["detail", "kind:diff"],
        activeToolId: null,
        tools: [],
      },
      directories: {
        "/work/radii": {
          checked: ["file", "diff"],
          active: "diff",
          fileTabs: [{ path: "/work/radii/App.tsx", host: "local", pinned: true }],
          activeFilePath: "/work/radii/App.tsx",
        },
      },
    };
    localStorage.setItem(BOT_PAGE_STATE_KEY, JSON.stringify(snapshot));

    expect(loadBotPageSnapshot()?.workspace?.dock).toBe("diff");
    const restored = readInitialBotWorkspace(null, ["radii"]);
    expect(restored.active).toBe("radii");
    expect(restored.openIssueIds).toEqual(["radii"]);
    expect(restored.panel).toEqual({ kind: "issue", issueId: "radii" });

    const patches = panelPatchesFromSnapshot(loadBotPageSnapshot()!);
    expect(patches["/work/radii"]?.fileTabs?.[0]).toMatchObject({
      path: "/work/radii/App.tsx",
      loading: true,
    });
    expect(patches["/work/radii"]?.fileTabs?.[0]).not.toHaveProperty("content");
    expect(takeRestoredFileLoads()).toEqual([
      { workdir: "/work/radii", path: "/work/radii/App.tsx", host: "local" },
    ]);
    expect(patches.assistant?.dockColumnOpen).toBe(true);
    expect(patches.assistant?.tabOrder).toEqual(["detail", "kind:diff"]);
  });

  it("keeps bot file previews on the assistant bar and reloads them", () => {
    const captured = captureBotPanels({
      assistant: group({
        fileTabs: [
          { path: "/work/radii/App.tsx", host: "local", content: "secret", pinned: true },
        ],
        activeFilePath: "/work/radii/App.tsx",
      }),
      "/work/radii": group({
        checked: ["diff"],
        active: "diff",
      }),
    });
    expect(captured.assistant?.fileTabs).toEqual([
      { path: "/work/radii/App.tsx", host: "local", pinned: true },
    ]);
    expect(captured.assistant?.activeFilePath).toBe("/work/radii/App.tsx");
    expect(captured.assistant?.fileTabs?.[0]).not.toHaveProperty("content");
    expect(captured.directories["/work/radii"]?.fileTabs).toEqual([]);

    const snapshot: BotPageSnapshot = {
      version: 1,
      workspace: null,
      assistant: {
        dockColumnOpen: true,
        widths: { preview: 420, diff: 420, terminal: 420, file: 420 },
        tabOrder: ["detail"],
        activeToolId: null,
        tools: [],
        fileTabs: [{ path: "/work/radii/App.tsx", host: "local" }],
        activeFilePath: "/work/radii/App.tsx",
      },
      directories: {},
    };
    const patches = panelPatchesFromSnapshot(snapshot);
    expect(patches.assistant?.fileTabs?.[0]).toMatchObject({
      path: "/work/radii/App.tsx",
      loading: true,
    });
    expect(patches.assistant?.fileTabs?.[0]).not.toHaveProperty("content");
    expect(patches.assistant?.checked).toEqual(["file"]);
    expect(takeRestoredFileLoads()).toEqual([
      { workdir: "assistant", path: "/work/radii/App.tsx", host: "local" },
    ]);
  });

  it("drops a saved issue that is no longer in the list", () => {
    expect(
      pruneBotWorkspace(
        {
          ...initialBotWorkspace(null),
          active: "gone",
          openIssueIds: ["gone"],
          panel: { kind: "issue", issueId: "gone" },
          lastIssueId: "gone",
        },
        ["radii"],
      ),
    ).toMatchObject({
      active: "bot",
      openIssueIds: [],
      panel: { kind: "none" },
      lastIssueId: null,
    });
  });

  it("ignores a corrupt snapshot", () => {
    localStorage.setItem(BOT_PAGE_STATE_KEY, "{");
    expect(loadBotPageSnapshot()).toBeNull();
    expect(readInitialBotWorkspace("radii").panel).toEqual({
      kind: "issue",
      issueId: "radii",
    });
  });
});
