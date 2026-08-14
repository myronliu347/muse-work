/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectSystemDark,
  getThemePreference,
  getThemeScaling,
  getThemeAccentColor,
  getThemeRadius,
  getThemeGrayColor,
  setThemePreference,
  setThemeScaling,
  setThemeAccentColor,
  setThemeRadius,
  setThemeGrayColor,
  subscribeThemePreference,
  subscribeThemeScaling,
  subscribeThemeAccentColor,
  subscribeThemeRadius,
  subscribeThemeGrayColor,
  readInitialPreference,
  readInitialScaling,
  readInitialAccentColor,
  readInitialRadius,
  readInitialGrayColor,
} from "../../src/ui/themePreference";
import { isDarkTheme } from "../../src/utils/theme";
import {
  THEME_PREFERENCE_STORAGE_KEY,
  THEME_SCALING_STORAGE_KEY,
  THEME_ACCENT_COLOR_STORAGE_KEY,
  THEME_RADIUS_STORAGE_KEY,
  THEME_GRAY_COLOR_STORAGE_KEY,
} from "../../src/ui/themeStorage";

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
    delete (window as Window & { __MUSE_THEME_SCALING__?: string })
      .__MUSE_THEME_SCALING__;
    delete (window as Window & { __MUSE_THEME_ACCENT__?: string })
      .__MUSE_THEME_ACCENT__;
    delete (window as Window & { __MUSE_THEME_RADIUS__?: string })
      .__MUSE_THEME_RADIUS__;
    delete (window as Window & { __MUSE_THEME_GRAY__?: string })
      .__MUSE_THEME_GRAY__;
    setThemePreference("system");
    setThemeScaling("100%");
    setThemeAccentColor("red");
    setThemeRadius("large");
    setThemeGrayColor("gray");
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

  it("prefers injected desktop scaling over localStorage", () => {
    localStorage.setItem(THEME_SCALING_STORAGE_KEY, "90%");
    (
      window as Window & { __MUSE_THEME_SCALING__: string }
    ).__MUSE_THEME_SCALING__ = "105%";
    expect(readInitialScaling()).toBe("105%");
  });

  it("notifies scaling subscribers on setThemeScaling", () => {
    const seen: string[] = [];
    const unsub = subscribeThemeScaling(() =>
      seen.push(getThemeScaling()),
    );
    setThemeScaling("110%");
    expect(seen).toEqual(["110%"]);
    unsub();
    setThemeScaling("90%");
    expect(seen).toEqual(["110%"]);
  });

  it("prefers injected desktop accent, radius, and gray over localStorage", () => {
    localStorage.setItem(THEME_ACCENT_COLOR_STORAGE_KEY, "gray");
    localStorage.setItem(THEME_RADIUS_STORAGE_KEY, "none");
    localStorage.setItem(THEME_GRAY_COLOR_STORAGE_KEY, "olive");
    (
      window as Window & { __MUSE_THEME_ACCENT__: string }
    ).__MUSE_THEME_ACCENT__ = "blue";
    (
      window as Window & { __MUSE_THEME_RADIUS__: string }
    ).__MUSE_THEME_RADIUS__ = "small";
    (
      window as Window & { __MUSE_THEME_GRAY__: string }
    ).__MUSE_THEME_GRAY__ = "slate";
    expect(readInitialAccentColor()).toBe("blue");
    expect(readInitialRadius()).toBe("small");
    expect(readInitialGrayColor()).toBe("slate");
  });

  it("notifies accent, radius, and gray subscribers", () => {
    const accents: string[] = [];
    const radii: string[] = [];
    const grays: string[] = [];
    const unsubAccent = subscribeThemeAccentColor(() =>
      accents.push(getThemeAccentColor()),
    );
    const unsubRadius = subscribeThemeRadius(() =>
      radii.push(getThemeRadius()),
    );
    const unsubGray = subscribeThemeGrayColor(() =>
      grays.push(getThemeGrayColor()),
    );
    setThemeAccentColor("teal");
    setThemeRadius("medium");
    setThemeGrayColor("mauve");
    expect(accents).toEqual(["teal"]);
    expect(radii).toEqual(["medium"]);
    expect(grays).toEqual(["mauve"]);
    unsubAccent();
    unsubRadius();
    unsubGray();
  });

  it("prefers an explicit data-theme over VS Code body classes", () => {
    document.body.className = "vscode-dark";
    document.documentElement.setAttribute("data-theme", "light");

    expect(isDarkTheme()).toBe(false);
  });
});
