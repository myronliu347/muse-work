/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  openFileTab,
  selectFileTab,
  closeFileTab,
  pinFileTab,
  upsertFileContentTab,
  emptyFileTabsState,
} from "../../src/muse/fileTabs";
import type { FileViewState } from "../../src/types";

const tab = (path: string, overrides: Partial<FileViewState> = {}): FileViewState =>
  ({ path, host: "local", content: "x", ...overrides });

describe("openFileTab", () => {
  it("opens the first file into a preview tab and activates it", () => {
    const next = openFileTab(emptyFileTabsState(), "/w/a.ts", "local");
    expect(next.activeFilePath).toBe("/w/a.ts");
    expect(next.fileTabs).toHaveLength(1);
    expect(next.fileTabs[0]).toEqual({
      path: "/w/a.ts",
      host: "local",
      loading: true,
      tabKey: "/w/a.ts",
    });
  });

  it("replaces the existing preview tab in place when one exists", () => {
    const state = {
      fileTabs: [
        tab("/w/pinned.ts", { pinned: true }),
        tab("/w/preview.ts"),
      ],
      activeFilePath: "/w/preview.ts",
    };
    const next = openFileTab(state, "/w/new.ts", "local");
    expect(next.activeFilePath).toBe("/w/new.ts");
    expect(next.fileTabs.map((t) => t.path)).toEqual([
      "/w/pinned.ts",
      "/w/new.ts",
    ]);
    // Position kept, pinned tab untouched.
    expect(next.fileTabs[1].pinned).toBeUndefined();
    expect(next.fileTabs[0].pinned).toBe(true);
  });

  it("appends a preview tab when all tabs are pinned", () => {
    const state = {
      fileTabs: [tab("/w/a.ts", { pinned: true })],
      activeFilePath: "/w/a.ts",
    };
    const next = openFileTab(state, "/w/b.ts", "local");
    expect(next.fileTabs.map((t) => t.path)).toEqual(["/w/a.ts", "/w/b.ts"]);
    expect(next.activeFilePath).toBe("/w/b.ts");
  });

  it("activates an already-open pinned tab without duplicating it", () => {
    const state = {
      fileTabs: [
        tab("/w/a.ts", { pinned: true }),
        tab("/w/b.ts"),
      ],
      activeFilePath: "/w/b.ts",
    };
    const next = openFileTab(state, "/w/a.ts", "local");
    expect(next.fileTabs).toHaveLength(2);
    expect(next.activeFilePath).toBe("/w/a.ts");
  });

  it("re-activates an already-open tab without clearing its content", () => {
    const state = {
      fileTabs: [tab("/w/a.ts", { pinned: true, content: "old" })],
      activeFilePath: "/w/a.ts",
    };
    const next = openFileTab(state, "/w/a.ts", "local", { startLine: 3 });
    expect(next.fileTabs).toHaveLength(1);
    expect(next.fileTabs[0].content).toBe("old");
    expect(next.fileTabs[0].loading).toBe(false);
    expect(next.fileTabs[0].startLine).toBe(3);
    expect(next.fileTabs[0].pinned).toBe(true);
  });

  it("reuses the open absolute tab when a relative link names the same file", () => {
    const state = {
      fileTabs: [
        tab("/work/radii/apps/spec-server/src/prototype/skeletons/prototype-html.ts", {
          pinned: true,
          content: "export {}",
          tabKey: "apps/spec-server/src/prototype/skeletons/prototype-html.ts",
        }),
      ],
      activeFilePath: "/work/other.ts",
    };
    const next = openFileTab(
      state,
      "apps/spec-server/src/prototype/skeletons/prototype-html.ts",
      "local",
      { pinned: true },
    );
    expect(next.fileTabs).toHaveLength(1);
    expect(next.fileTabs[0].content).toBe("export {}");
    expect(next.fileTabs[0].tabKey).toBe(
      "apps/spec-server/src/prototype/skeletons/prototype-html.ts",
    );
    expect(next.activeFilePath).toBe(
      "/work/radii/apps/spec-server/src/prototype/skeletons/prototype-html.ts",
    );
  });

  it("opens pinned files as permanent tabs without consuming the preview slot", () => {
    const state = {
      fileTabs: [tab("/w/preview.ts")],
      activeFilePath: "/w/preview.ts",
    };
    const next = openFileTab(state, "/w/pinned.ts", "local", {
      pinned: true,
    });
    expect(next.fileTabs.map((t) => t.path)).toEqual([
      "/w/preview.ts",
      "/w/pinned.ts",
    ]);
    expect(next.fileTabs[1].pinned).toBe(true);
    expect(next.activeFilePath).toBe("/w/pinned.ts");
  });

  it("pins an already-open preview tab when opened pinned (double-click)", () => {
    const state = {
      fileTabs: [tab("/w/a.ts")],
      activeFilePath: "/w/a.ts",
    };
    const next = openFileTab(state, "/w/a.ts", "local", { pinned: true });
    expect(next.fileTabs).toHaveLength(1);
    expect(next.fileTabs[0].pinned).toBe(true);
    expect(next.fileTabs[0].loading).toBe(false);
    expect(next.activeFilePath).toBe("/w/a.ts");
  });
});

describe("selectFileTab", () => {
  it("activates an open tab", () => {
    const state = {
      fileTabs: [tab("/w/a.ts"), tab("/w/b.ts")],
      activeFilePath: "/w/a.ts",
    };
    expect(selectFileTab(state, "/w/b.ts").activeFilePath).toBe("/w/b.ts");
  });

  it("is a no-op for a path that is not open", () => {
    const state = {
      fileTabs: [tab("/w/a.ts")],
      activeFilePath: "/w/a.ts",
    };
    expect(selectFileTab(state, "/w/nope.ts")).toBe(state);
  });
});

describe("closeFileTab", () => {
  it("closing the active tab activates the left neighbor", () => {
    const state = {
      fileTabs: [tab("/w/a.ts"), tab("/w/b.ts"), tab("/w/c.ts")],
      activeFilePath: "/w/b.ts",
    };
    const next = closeFileTab(state, "/w/b.ts");
    expect(next.fileTabs.map((t) => t.path)).toEqual(["/w/a.ts", "/w/c.ts"]);
    expect(next.activeFilePath).toBe("/w/a.ts");
  });

  it("closing the leftmost active tab activates the right neighbor", () => {
    const state = {
      fileTabs: [tab("/w/a.ts"), tab("/w/b.ts")],
      activeFilePath: "/w/a.ts",
    };
    expect(closeFileTab(state, "/w/a.ts").activeFilePath).toBe("/w/b.ts");
  });

  it("closing the last tab returns to the placeholder", () => {
    const state = {
      fileTabs: [tab("/w/a.ts")],
      activeFilePath: "/w/a.ts",
    };
    const next = closeFileTab(state, "/w/a.ts");
    expect(next.fileTabs).toEqual([]);
    expect(next.activeFilePath).toBeNull();
  });

  it("closing an inactive tab keeps the active one", () => {
    const state = {
      fileTabs: [tab("/w/a.ts"), tab("/w/b.ts")],
      activeFilePath: "/w/b.ts",
    };
    const next = closeFileTab(state, "/w/a.ts");
    expect(next.fileTabs.map((t) => t.path)).toEqual(["/w/b.ts"]);
    expect(next.activeFilePath).toBe("/w/b.ts");
  });
});

describe("pinFileTab", () => {
  it("pins a preview tab", () => {
    const state = {
      fileTabs: [tab("/w/a.ts")],
      activeFilePath: "/w/a.ts",
    };
    const next = pinFileTab(state, "/w/a.ts");
    expect(next.fileTabs[0].pinned).toBe(true);
    expect(next.activeFilePath).toBe("/w/a.ts");
  });

  it("is a no-op for an already-pinned tab", () => {
    const state = {
      fileTabs: [tab("/w/a.ts", { pinned: true })],
      activeFilePath: "/w/a.ts",
    };
    expect(pinFileTab(state, "/w/a.ts")).toBe(state);
  });
});

describe("upsertFileContentTab", () => {
  it("fills an existing tab, keeping its pin state and position", () => {
    const state = {
      fileTabs: [
        tab("/w/a.ts", { pinned: true }),
        tab("/w/b.ts"),
      ],
      activeFilePath: "/w/b.ts",
    };
    const incoming = tab("/w/b.ts", {
      content: "new content",
      loading: false,
    });
    const next = upsertFileContentTab(state, incoming);
    expect(next.fileTabs).toHaveLength(2);
    expect(next.fileTabs[1].content).toBe("new content");
    expect(next.fileTabs[1].pinned).toBeUndefined();
    expect(next.activeFilePath).toBe("/w/b.ts");
  });

  it("keeps the active tab unchanged when filling a background tab", () => {
    const state = {
      fileTabs: [tab("/w/a.ts"), tab("/w/b.ts")],
      activeFilePath: "/w/a.ts",
    };
    const next = upsertFileContentTab(
      state,
      tab("/w/b.ts", { content: "filled" }),
    );
    expect(next.activeFilePath).toBe("/w/a.ts");
  });

  it("builds a tab and activates it when the path is not open", () => {
    const state = { fileTabs: [], activeFilePath: null };
    const next = upsertFileContentTab(
      state,
      tab("/w/c.ts", { content: "c" }),
    );
    expect(next.fileTabs).toHaveLength(1);
    expect(next.activeFilePath).toBe("/w/c.ts");
    expect(next.fileTabs[0].pinned).toBe(false);
  });

  it("stores a not-found error when a caller fills the stub directly", () => {
    const state = openFileTab(emptyFileTabsState(), "missing.ts", "local");
    const next = upsertFileContentTab(state, {
      path: "missing.ts",
      host: "local",
      error: "文件不存在：/w/missing.ts",
    });
    expect(next.fileTabs).toHaveLength(1);
    expect(next.fileTabs[0].loading).toBeUndefined();
    expect(next.fileTabs[0].error).toBe("文件不存在：/w/missing.ts");
    expect(next.activeFilePath).toBe("missing.ts");
  });

  it("keeps the dock identity when a relative stub is resolved", () => {
    const state = openFileTab(
      emptyFileTabsState(),
      "apps/spec-server/src/prototype/skeletons/prototype-html.ts",
      "local",
    );
    const next = upsertFileContentTab(
      state,
      tab("/work/radii/apps/spec-server/src/prototype/skeletons/prototype-html.ts", {
        content: "export {}\n",
      }),
      "apps/spec-server/src/prototype/skeletons/prototype-html.ts",
    );
    expect(next.fileTabs).toHaveLength(1);
    expect(next.fileTabs[0].path).toBe(
      "/work/radii/apps/spec-server/src/prototype/skeletons/prototype-html.ts",
    );
    expect(next.fileTabs[0].tabKey).toBe(
      "apps/spec-server/src/prototype/skeletons/prototype-html.ts",
    );
    expect(next.activeFilePath).toBe(next.fileTabs[0].path);
  });

  it("replaces a requested-path stub with the resolved file path", () => {
    const state = openFileTab(emptyFileTabsState(), "hello.ts", "local");
    const next = upsertFileContentTab(
      state,
      tab("/w/src/hello.ts", { content: "export {}\n" }),
      "hello.ts",
    );
    expect(next.fileTabs.map((t) => t.path)).toEqual(["/w/src/hello.ts"]);
    expect(next.activeFilePath).toBe("/w/src/hello.ts");
    expect(next.fileTabs[0].content).toBe("export {}\n");
  });
});
