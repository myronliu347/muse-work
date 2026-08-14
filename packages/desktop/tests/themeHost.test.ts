import { describe, expect, it, vi } from "vitest";
import { installThemeHost } from "../src/main/themeHost.js";
import { getUiPrefsPath, loadUiPrefs } from "../src/main/uiPrefs.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("themeHost", () => {
  it("persists themeScaling from desktopSetThemeScaling IPC", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipc = {
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        listeners.set(channel, handler);
      }),
      removeListener: vi.fn(),
    };
    const nativeTheme = {
      themeSource: "system" as const,
      shouldUseDarkColors: false,
      on: vi.fn(),
      off: vi.fn(),
    };
    const send = vi.fn();
    const host = installThemeHost({
      home,
      ipc,
      nativeTheme: nativeTheme as never,
      getWindow: () =>
        ({
          setBackgroundColor: vi.fn(),
          webContents: { send },
        }) as never,
    });

    expect(host.scaling).toBe("100%");

    listeners.get("muse:from-webview")?.({}, {
      command: "desktopSetThemeScaling",
      scaling: "105%",
    });

    expect(host.scaling).toBe("105%");
    expect(loadUiPrefs(home).themeScaling).toBe("105%");

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("persists accent color and radius", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipc = {
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        listeners.set(channel, handler);
      }),
      removeListener: vi.fn(),
    };
    const nativeTheme = {
      themeSource: "system" as const,
      shouldUseDarkColors: false,
      on: vi.fn(),
      off: vi.fn(),
    };
    const host = installThemeHost({
      home,
      ipc,
      nativeTheme: nativeTheme as never,
      getWindow: () => null,
    });

    listeners.get("muse:from-webview")?.({}, {
      command: "desktopSetThemeAccentColor",
      accentColor: "teal",
    });
    listeners.get("muse:from-webview")?.({}, {
      command: "desktopSetThemeRadius",
      radius: "medium",
    });

    expect(host.accentColor).toBe("teal");
    expect(host.radius).toBe("medium");
    expect(loadUiPrefs(home).themeAccentColor).toBe("teal");
    expect(loadUiPrefs(home).themeRadius).toBe("medium");

    listeners.get("muse:from-webview")?.({}, {
      command: "desktopSetThemeGrayColor",
      grayColor: "slate",
    });

    expect(host.grayColor).toBe("slate");
    expect(loadUiPrefs(home).themeGrayColor).toBe("slate");

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("ignores invalid scaling values", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    fs.mkdirSync(path.dirname(getUiPrefsPath(home)), { recursive: true });
    fs.writeFileSync(
      getUiPrefsPath(home),
      JSON.stringify({
        version: 1,
        themePreference: "system",
        themeScaling: "95%",
        themeAccentColor: "red",
        themeRadius: "large",
        themeGrayColor: "gray",
      }),
      "utf8",
    );

    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipc = {
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        listeners.set(channel, handler);
      }),
      removeListener: vi.fn(),
    };
    const nativeTheme = {
      themeSource: "system" as const,
      shouldUseDarkColors: false,
      on: vi.fn(),
      off: vi.fn(),
    };
    const host = installThemeHost({
      home,
      ipc,
      nativeTheme: nativeTheme as never,
      getWindow: () => null,
    });

    expect(host.scaling).toBe("95%");

    listeners.get("muse:from-webview")?.({}, {
      command: "desktopSetThemeScaling",
      scaling: "150%",
    });

    expect(host.scaling).toBe("95%");
    expect(loadUiPrefs(home).themeScaling).toBe("95%");

    fs.rmSync(home, { recursive: true, force: true });
  });
});
