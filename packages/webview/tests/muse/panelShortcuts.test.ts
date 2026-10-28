/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

function keyEvent(
  init: Partial<KeyboardEvent> & { key: string; code?: string },
): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? "",
    metaKey: Boolean(init.metaKey),
    ctrlKey: Boolean(init.ctrlKey),
    shiftKey: Boolean(init.shiftKey),
    altKey: Boolean(init.altKey),
    isComposing: false,
  } as KeyboardEvent;
}

describe("matchPanelShortcut", () => {
  const platform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("matches mac panel shortcuts", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    vi.resetModules();
    const { matchPanelShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchPanelShortcut(
        keyEvent({ key: "P", metaKey: true, shiftKey: true }),
      ),
    ).toBe("preview");
    expect(
      matchPanelShortcut(
        keyEvent({ key: "d", metaKey: true, shiftKey: true }),
      ),
    ).toBe("diff");
    expect(
      matchPanelShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true }),
      ),
    ).toBe("file");
    expect(
      matchPanelShortcut(
        keyEvent({ key: "`", code: "Backquote", ctrlKey: true }),
      ),
    ).toBe("terminal");
    expect(
      matchPanelShortcut(keyEvent({ key: "p", metaKey: true })),
    ).toBeNull();
  });

  it("matches non-mac panel shortcuts", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    vi.resetModules();
    const { matchPanelShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchPanelShortcut(
        keyEvent({ key: "p", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("preview");
    expect(
      matchPanelShortcut(
        keyEvent({ key: "`", code: "Backquote", ctrlKey: true }),
      ),
    ).toBe("terminal");
  });
});

describe("matchTabStepShortcut", () => {
  const platform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("matches Cmd+[ and Cmd+] on mac", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    vi.resetModules();
    const { matchTabStepShortcut, stepTab } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchTabStepShortcut(keyEvent({ key: "[", code: "BracketLeft", metaKey: true })),
    ).toBe(-1);
    expect(
      matchTabStepShortcut(keyEvent({ key: "]", code: "BracketRight", metaKey: true })),
    ).toBe(1);
    expect(
      matchTabStepShortcut(
        keyEvent({ key: "]", code: "BracketRight", metaKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      matchTabStepShortcut(keyEvent({ key: "]", code: "BracketRight", ctrlKey: true })),
    ).toBeNull();
    expect(stepTab(["a", "b", "c"], "b", 1)).toBe("c");
    expect(stepTab(["a", "b", "c"], "b", -1)).toBe("a");
    expect(stepTab(["a", "b", "c"], "c", 1)).toBe("a");
    expect(stepTab(["only"], "only", 1)).toBeNull();
  });

  it("matches Ctrl+[ and Ctrl+] on Windows", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    vi.resetModules();
    const { matchTabStepShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchTabStepShortcut(keyEvent({ key: "[", code: "BracketLeft", ctrlKey: true })),
    ).toBe(-1);
    expect(
      matchTabStepShortcut(keyEvent({ key: "]", metaKey: true })),
    ).toBeNull();
  });
});

describe("matchNewSessionShortcut", () => {
  const platform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("matches Cmd+N on mac and ignores Shift/Ctrl variants", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    vi.resetModules();
    const { matchNewSessionShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchNewSessionShortcut(keyEvent({ key: "n", metaKey: true })),
    ).toBe(true);
    expect(
      matchNewSessionShortcut(keyEvent({ key: "N", metaKey: true })),
    ).toBe(true);
    expect(
      matchNewSessionShortcut(
        keyEvent({ key: "n", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      matchNewSessionShortcut(keyEvent({ key: "n", ctrlKey: true })),
    ).toBe(false);
  });

  it("matches Ctrl+N on Windows", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    vi.resetModules();
    const { matchNewSessionShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchNewSessionShortcut(keyEvent({ key: "n", ctrlKey: true })),
    ).toBe(true);
    expect(
      matchNewSessionShortcut(keyEvent({ key: "n", metaKey: true })),
    ).toBe(false);
  });
});

describe("matchDockFullscreenShortcut", () => {
  const platform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("matches Control+Command+F on mac", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    vi.resetModules();
    const { matchDockFullscreenShortcut, dockFullscreenShortcutLabel } =
      await import("../../src/muse/panelShortcuts.js");
    expect(
      matchDockFullscreenShortcut(
        keyEvent({ key: "f", ctrlKey: true, metaKey: true }),
      ),
    ).toBe(true);
    expect(
      matchDockFullscreenShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(dockFullscreenShortcutLabel()).toBe("⌃⌘F");
  });

  it("matches F11 on Windows", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    vi.resetModules();
    const { matchDockFullscreenShortcut, dockFullscreenShortcutLabel } =
      await import("../../src/muse/panelShortcuts.js");
    expect(matchDockFullscreenShortcut(keyEvent({ key: "F11" }))).toBe(true);
    expect(
      matchDockFullscreenShortcut(
        keyEvent({ key: "f", ctrlKey: true, metaKey: true }),
      ),
    ).toBe(false);
    expect(dockFullscreenShortcutLabel()).toBe("F11");
  });
});

describe("matchDockToggleShortcut", () => {
  const platform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("matches Cmd+J on mac", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    vi.resetModules();
    const { matchDockToggleShortcut, dockToggleShortcutLabel } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchDockToggleShortcut(keyEvent({ key: "j", metaKey: true })),
    ).toBe(true);
    expect(
      matchDockToggleShortcut(
        keyEvent({ key: "j", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(dockToggleShortcutLabel()).toBe("⌘J");
  });

  it("matches Ctrl+J on Windows", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    vi.resetModules();
    const { matchDockToggleShortcut, dockToggleShortcutLabel } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchDockToggleShortcut(keyEvent({ key: "j", ctrlKey: true })),
    ).toBe(true);
    expect(
      matchDockToggleShortcut(keyEvent({ key: "j", metaKey: true })),
    ).toBe(false);
    expect(dockToggleShortcutLabel()).toBe("Ctrl+J");
  });
});

describe("matchQuickOpenShortcut", () => {
  const platform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("matches cmd/ctrl+p without shift", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    vi.resetModules();
    const { matchQuickOpenShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchQuickOpenShortcut(keyEvent({ key: "p", metaKey: true })),
    ).toBe(true);
    expect(
      matchQuickOpenShortcut(
        keyEvent({ key: "p", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("matches Ctrl+P on Windows", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    vi.resetModules();
    const { matchQuickOpenShortcut } = await import(
      "../../src/muse/panelShortcuts.js"
    );
    expect(
      matchQuickOpenShortcut(keyEvent({ key: "p", ctrlKey: true })),
    ).toBe(true);
    expect(
      matchQuickOpenShortcut(
        keyEvent({ key: "p", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });
});
