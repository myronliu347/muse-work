/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectSystemDark,
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
  readInitialPreference,
} from "../../src/ui/themePreference";
import { isDarkTheme } from "../../src/utils/theme";
import { THEME_PREFERENCE_STORAGE_KEY } from "../../src/ui/themeStorage";

describe("themePreference store", () => {
  beforeEach(() => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
      },
    });
    delete (window as Window & { __MUSE_THEME_PREFERENCE__?: string })
      .__MUSE_THEME_PREFERENCE__;
    setThemePreference("system");
  });

  it("prefers injected desktop value over localStorage", () => {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "dark");
    (
      window as Window & { __MUSE_THEME_PREFERENCE__: string }
    ).__MUSE_THEME_PREFERENCE__ = "light";
    expect(readInitialPreference()).toBe("light");
  });

  it("notifies subscribers on setThemePreference", () => {
    const seen: string[] = [];
    const unsub = subscribeThemePreference(() =>
      seen.push(getThemePreference()),
    );
    setThemePreference("dark");
    expect(seen).toEqual(["dark"]);
    unsub();
    setThemePreference("light");
    expect(seen).toEqual(["dark"]);
  });

  it("uses host-specific signals when detecting system darkness", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
      }),
    });
    document.documentElement.setAttribute("data-theme", "dark");
    window.waveHostType = "desktop";
    expect(detectSystemDark()).toBe(false);

    delete window.waveHostType;
    expect(detectSystemDark()).toBe(true);

    document.documentElement.removeAttribute("data-theme");
    document.body.classList.add("vscode-light");
    expect(detectSystemDark()).toBe(false);
    document.body.classList.remove("vscode-light");
  });

  it("prefers an explicit data-theme over VS Code body classes", () => {
    document.body.className = "vscode-dark";
    document.documentElement.setAttribute("data-theme", "light");

    expect(isDarkTheme()).toBe(false);
  });
});
