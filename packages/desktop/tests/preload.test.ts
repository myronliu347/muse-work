import { describe, expect, it, vi } from "vitest";

// Expose the main-window preload's world bridge for assertions.
const { exposeInMainWorld } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { on: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn(() => "/tmp/file.png") },
}));

vi.mock("../src/main/uiPrefs.js", () => ({
  loadUiPrefs: () => ({
    version: 1,
    themePreference: "system",
    themeScaling: "100%",
    themeAccentColor: "red",
    themeRadius: "large",
    themeGrayColor: "gray",
  }),
}));

// The preload touches document at load (boot theme) — provide a minimal stub
// so importing it under node doesn't throw.
vi.stubGlobal("document", {
  documentElement: { setAttribute: vi.fn() },
  addEventListener: vi.fn(),
});

describe("main preload", () => {
  it("exposes musePickerPreloadPath as a file:// URL next to itself", async () => {
    await import("../src/main/preload.js");

    const pickerCall = exposeInMainWorld.mock.calls.find(
      ([key]) => key === "musePickerPreloadPath",
    );
    expect(pickerCall).toBeDefined();
    const url: string = pickerCall![1];
    expect(url).toMatch(/^file:\/\//);
    expect(url).toMatch(/pickerPreload\.cjs$/);
  });
});
