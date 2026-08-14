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
