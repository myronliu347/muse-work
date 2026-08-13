/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
  readInitialPreference,
} from "../../src/ui/themePreference";
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
});
