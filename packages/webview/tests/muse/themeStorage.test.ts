import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  THEME_PREFERENCE_STORAGE_KEY,
  isThemePreference,
  readStoredPreference,
  resolveEffectiveTheme,
  writeStoredPreference,
} from "../../src/ui/themeStorage";

describe("themeStorage", () => {
  const memory = new Map<string, string>();
  const store: Storage = {
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
    getItem: (k) => memory.get(k) ?? null,
    key: (i) => [...memory.keys()][i] ?? null,
    removeItem: (k) => void memory.delete(k),
    setItem: (k, v) => void memory.set(k, v),
  };

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: store,
    });
  });
  afterEach(() => {
    memory.clear();
  });

  it("treats system + dark media as dark", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });

  it("ignores media when preference is fixed", () => {
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
  });

  it("defaults to system when storage is empty or corrupt", () => {
    expect(readStoredPreference()).toBe("system");
    store.setItem(THEME_PREFERENCE_STORAGE_KEY, "nope");
    expect(readStoredPreference()).toBe("system");
  });

  it("round-trips a valid preference", () => {
    writeStoredPreference("dark");
    expect(readStoredPreference()).toBe("dark");
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
  });

  it("stays in memory when localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readStoredPreference()).toBe("system");
    expect(() => writeStoredPreference("light")).not.toThrow();
  });
});
