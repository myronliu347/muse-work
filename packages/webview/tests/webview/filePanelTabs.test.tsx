import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import {
  renderChatApp,
  sendExtensionMessage,
  createMockVscode,
} from "./test-utils";
import { usePanelGroupStore } from "../../src/stores/panelGroupStore";

/**
 * desktopFileContent 宿主回推（多 tab 写路径）：按 path 定位 tab 覆写（保留
 * pinned 与位置），tab 不存在时补建并激活。
 */
describe("desktopFileContent multi-tab routing (messageRouter)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const groupState = () =>
    usePanelGroupStore.getState().groups["/mock/workdir"];

  it("creates a tab and activates it when the path is not open", async () => {
    renderChatApp(createMockVscode());
    // The panel group is created lazily on first use.
    expect(groupState()).toBeUndefined();

    await act(async () => {
      sendExtensionMessage({
        command: "desktopFileContent",
        fileView: {
          path: "/mock/workdir/a.ts",
          host: "local",
          content: "const a = 1;\n",
        },
      });
    });

    expect(groupState().fileTabs).toHaveLength(1);
    expect(groupState().fileTabs[0].path).toBe("/mock/workdir/a.ts");
    expect(groupState().activeFilePath).toBe("/mock/workdir/a.ts");
  });

  it("overwrites an existing tab, keeping its pin state and position", async () => {
    renderChatApp(createMockVscode());
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      fileTabs: [
        { path: "/mock/workdir/pinned.ts", host: "local", content: "old", pinned: true },
        { path: "/mock/workdir/preview.ts", host: "local", content: "old" },
      ],
      activeFilePath: "/mock/workdir/pinned.ts",
    });

    await act(async () => {
      sendExtensionMessage({
        command: "desktopFileContent",
        fileView: {
          path: "/mock/workdir/preview.ts",
          host: "local",
          content: "new content",
        },
      });
    });

    const tabs = groupState().fileTabs;
    expect(tabs.map((t) => t.path)).toEqual([
      "/mock/workdir/pinned.ts",
      "/mock/workdir/preview.ts",
    ]);
    expect(tabs[1].content).toBe("new content");
    // Filling a background tab does not steal activation.
    expect(groupState().activeFilePath).toBe("/mock/workdir/pinned.ts");
    expect(tabs[0].pinned).toBe(true);
    expect(tabs[1].pinned).toBeUndefined();
  });

  it("preserves pin state when a pinned tab's content is refreshed", async () => {
    renderChatApp(createMockVscode());
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      fileTabs: [
        { path: "/mock/workdir/a.ts", host: "local", content: "old", pinned: true },
      ],
      activeFilePath: "/mock/workdir/a.ts",
    });

    await act(async () => {
      sendExtensionMessage({
        command: "desktopFileContent",
        fileView: {
          path: "/mock/workdir/a.ts",
          host: "local",
          content: "refreshed",
        },
      });
    });

    expect(groupState().fileTabs[0].content).toBe("refreshed");
    expect(groupState().fileTabs[0].pinned).toBe(true);
    expect(groupState().fileTabs).toHaveLength(1);
  });

  it("replaces a requested-path loading stub with the resolved file", async () => {
    renderChatApp(createMockVscode());
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      fileTabs: [
        { path: "hello.ts", host: "local", loading: true },
      ],
      activeFilePath: "hello.ts",
    });

    await act(async () => {
      sendExtensionMessage({
        command: "desktopFileContent",
        requestedPath: "hello.ts",
        fileView: {
          path: "/mock/workdir/src/hello.ts",
          host: "local",
          content: "export {}\n",
        },
      });
    });

    expect(groupState().fileTabs.map((t) => t.path)).toEqual([
      "/mock/workdir/src/hello.ts",
    ]);
    expect(groupState().activeFilePath).toBe("/mock/workdir/src/hello.ts");
  });

  it("openQuickOpen closes the loading stub and shows the palette", async () => {
    renderChatApp(createMockVscode());
    usePanelGroupStore.getState().patchGroup("/mock/workdir", {
      fileTabs: [{ path: "hello.ts", host: "local", loading: true }],
      activeFilePath: "hello.ts",
    });

    await act(async () => {
      sendExtensionMessage({
        command: "openQuickOpen",
        query: "hello.ts",
        path: "hello.ts",
      });
    });

    expect(groupState().fileTabs).toEqual([]);
    expect(screen.getByTestId("quick-open")).toBeInTheDocument();
    expect(screen.getByTestId("quick-open-input")).toHaveValue("hello.ts");
  });
});
