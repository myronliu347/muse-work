# Webview UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `@radix-ui/themes` + `motion` 给 Muse webview 落地红强调色主题、system/light/dark 外观，以及表单 DS、设置页和应用页 chrome。

**Architecture:** `MuseTheme` 包住 React 树，把 `ThemePreference` 解析成 `effective` 并写入 `html[data-theme]` 与 Radix `appearance`。桌面以 `~/.muse-work/ui.json` + `nativeTheme.themeSource` 为权威源；webview 用 localStorage 缓存。表单直接用 Radix 控件，只加 `Field` 胶水。应用页只换 CSS token，不改信息架构。

**Tech Stack:** pnpm monorepo、React 18、`@radix-ui/themes`、`motion`、esbuild IIFE、Electron `nativeTheme`、Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-08-13-webview-ui-design.md`

## Global Constraints

- Theme：`accentColor="red"` · `grayColor="gray"` · `panelBackground="solid"` · `radius="large"`
- `appearance` 只传 `"light"` 或 `"dark"`，不传 `inherit`
- 偏好：`system` | `light` | `dark`，默认 `system`；外观切换立即生效，不走供应商保存
- 动效库：`motion`（`motion/react`），禁止 `react-motion`
- 强调色只用在：发送按钮、输入焦点、未读点、主按钮、选中外观卡片、Tab 下划线
- 不改会话树 / 分屏 / 发消息 / 供应商保存语义
- 包管理器：pnpm；测试：Vitest；新测试放在 `packages/webview/tests/muse/**` 或 `tests/components/**`（当前 vitest include 不含 `tests/webview/*`）
- 品牌名：Muse Work

## File Structure

```text
packages/webview/package.json                    # + @radix-ui/themes, motion
packages/webview/src/index.tsx                   # 根包 MuseTheme；import radix css
packages/webview/src/ui/themeStorage.ts          # localStorage + resolveEffectiveTheme
packages/webview/src/ui/themePreference.ts       # 模块级 store，多 ChatApp 实例同步
packages/webview/src/ui/theme.tsx                # MuseTheme + useMuseTheme
packages/webview/src/ui/Field.tsx                # label / hint / error 布局
packages/webview/src/components/AppearanceSettings.tsx
packages/webview/src/components/ConfigDialog.tsx # 「设置」+ 外观/供应商 tabs + Dialog 动效
packages/webview/src/components/MuseProviderSettings.tsx  # Radix 表单控件
packages/webview/src/components/ChatApp.tsx      # 不再写 data-theme
packages/webview/src/types/index.ts              # ThemePreference；ThemeState.preference
packages/webview/src/styles/{DesktopApp,ChatHeader,Message,MessageInput,MessageList}.css
packages/desktop/src/main/uiPrefs.ts
packages/desktop/src/main/themeHost.ts
packages/desktop/src/main/{window,preload,index}.ts
packages/webview/tests/muse/themeStorage.test.ts
packages/webview/tests/muse/themePreference.test.ts
packages/webview/tests/components/appearanceSettings.test.tsx
packages/webview/tests/components/configDialog.appearance.test.tsx
packages/desktop/tests/uiPrefs.test.ts
```

---

### Task 1: `themeStorage` 解析与读写

**Files:**
- Create: `packages/webview/src/ui/themeStorage.ts`
- Create: `packages/webview/tests/muse/themeStorage.test.ts`
- Modify: `packages/webview/src/types/index.ts`（`ThemePreference` + `ThemeState.preference`）

**Interfaces:**
- Consumes: none
- Produces:
  - `export type ThemePreference = "system" | "light" | "dark"`
  - `export const THEME_PREFERENCE_STORAGE_KEY = "muse.themePreference"`
  - `export function isThemePreference(value: unknown): value is ThemePreference`
  - `export function resolveEffectiveTheme(preference: ThemePreference, isSystemDark: boolean): EffectiveTheme`
  - `export function readStoredPreference(): ThemePreference`
  - `export function writeStoredPreference(preference: ThemePreference): void`

- [ ] **Step 1: 扩展类型**

在 `packages/webview/src/types/index.ts` 把现有 `EffectiveTheme` / `ThemeState` 换成：

```ts
export type EffectiveTheme = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";

export interface ThemeState {
  /** Present only when the in-app store owns the snapshot; host IPC may omit it. */
  preference?: ThemePreference;
  effective: EffectiveTheme;
}
```

删除「desktop follows the OS only, no in-app preference (FR-016)」那句注释。

- [ ] **Step 2: 写失败测试**

```ts
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @muse-work/webview test tests/muse/themeStorage.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现**

```ts
import type { EffectiveTheme, ThemePreference } from "../types";

export const THEME_PREFERENCE_STORAGE_KEY = "muse.themePreference";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  isSystemDark: boolean,
): EffectiveTheme {
  if (preference === "light" || preference === "dark") return preference;
  return isSystemDark ? "dark" : "light";
}

export function readStoredPreference(): ThemePreference {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    // privacy mode
  }
  return "system";
}

export function writeStoredPreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // privacy mode: session-only
  }
}
```

- [ ] **Step 5: 再跑测试**

Run: `pnpm -F @muse-work/webview test tests/muse/themeStorage.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/webview/src/ui/themeStorage.ts packages/webview/tests/muse/themeStorage.test.ts packages/webview/src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(webview): add theme preference storage and resolver

EOF
)"
```

---

### Task 2: `MuseTheme` 根主题 + 停止 ChatApp 双写 `data-theme`

**Files:**
- Create: `packages/webview/src/ui/themePreference.ts`
- Create: `packages/webview/src/ui/theme.tsx`
- Create: `packages/webview/tests/muse/themePreference.test.ts`
- Modify: `packages/webview/package.json`（加依赖）
- Modify: `packages/webview/src/index.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`（删掉两处写 `data-theme`）

**Interfaces:**
- Consumes: Task 1 的 `readStoredPreference` / `writeStoredPreference` / `resolveEffectiveTheme` / `isThemePreference`
- Produces:
  - `export function detectSystemDark(): boolean`
  - `export function readInitialPreference(): ThemePreference`
  - `export function getThemePreference(): ThemePreference`
  - `export function setThemePreference(preference: ThemePreference): void`
  - `export function subscribeThemePreference(listener: () => void): () => void`
  - `export function MuseTheme(props: { children: React.ReactNode }): JSX.Element`
  - `export function useMuseTheme(): { preference: ThemePreference; effective: EffectiveTheme; setPreference: (p: ThemePreference) => void }`

- [ ] **Step 1: 安装依赖**

Run:

```bash
pnpm -F @muse-work/webview add @radix-ui/themes motion
```

Expected: `packages/webview/package.json` 出现 `@radix-ui/themes` 与 `motion`。

- [ ] **Step 2: 写 store 失败测试**

```ts
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @muse-work/webview test tests/muse/themePreference.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 store + MuseTheme**

`packages/webview/src/ui/themePreference.ts`:

```ts
import type { ThemePreference } from "../types";
import { isDarkTheme } from "../utils/theme";
import {
  isThemePreference,
  readStoredPreference,
  writeStoredPreference,
} from "./themeStorage";

const listeners = new Set<() => void>();
let current: ThemePreference = "system";
let initialized = false;

export function detectSystemDark(): boolean {
  if (typeof document !== "undefined") {
    const body = document.body?.classList;
    if (
      body?.contains("vscode-dark") ||
      body?.contains("vscode-high-contrast") ||
      body?.contains("vscode-light") ||
      body?.contains("vscode-high-contrast-light")
    ) {
      return isDarkTheme();
    }
  }
  return Boolean(
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
}

export function readInitialPreference(): ThemePreference {
  const injected = (globalThis as { __MUSE_THEME_PREFERENCE__?: unknown })
    .__MUSE_THEME_PREFERENCE__;
  if (isThemePreference(injected)) return injected;
  return readStoredPreference();
}

export function getThemePreference(): ThemePreference {
  if (!initialized) {
    current = readInitialPreference();
    initialized = true;
  }
  return current;
}

export function setThemePreference(preference: ThemePreference): void {
  current = preference;
  initialized = true;
  writeStoredPreference(preference);
  if (
    typeof window !== "undefined" &&
    window.waveHostType === "desktop" &&
    typeof window.acquireVsCodeApi === "function"
  ) {
    window.acquireVsCodeApi().postMessage({
      command: "desktopSetThemePreference",
      preference,
    });
  }
  listeners.forEach((fn) => fn());
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

`packages/webview/src/ui/theme.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { Theme } from "@radix-ui/themes";
import type { EffectiveTheme, ThemePreference } from "../types";
import { resolveEffectiveTheme } from "./themeStorage";
import {
  detectSystemDark,
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
} from "./themePreference";

function applyDataTheme(effective: EffectiveTheme): void {
  document.documentElement.setAttribute("data-theme", effective);
}

export function MuseTheme({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  const [systemDark, setSystemDark] = useState(() => detectSystemDark());

  useEffect(() => subscribeThemePreference(() => {
    setPreferenceState(getThemePreference());
  }), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => setSystemDark(detectSystemDark());
    media.addEventListener("change", onMedia);
    const observer = new MutationObserver(onMedia);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const onHost = (event: MessageEvent) => {
      const data = event.data as { command?: string; effective?: string };
      if (data?.command !== "desktopThemeChange") return;
      if (getThemePreference() !== "system") return;
      if (data.effective === "light" || data.effective === "dark") {
        setSystemDark(data.effective === "dark");
      }
    };
    window.addEventListener("message", onHost);
    return () => {
      media.removeEventListener("change", onMedia);
      observer.disconnect();
      window.removeEventListener("message", onHost);
    };
  }, []);

  const effective = useMemo(
    () => resolveEffectiveTheme(preference, systemDark),
    [preference, systemDark],
  );

  useEffect(() => {
    applyDataTheme(effective);
  }, [effective]);

  return (
    <Theme
      accentColor="red"
      grayColor="gray"
      panelBackground="solid"
      radius="large"
      appearance={effective}
    >
      {children}
    </Theme>
  );
}

export function useMuseTheme(): {
  preference: ThemePreference;
  effective: EffectiveTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  useEffect(() => subscribeThemePreference(() => {
    setPreferenceState(getThemePreference());
  }), []);
  const effective = resolveEffectiveTheme(preference, detectSystemDark());
  return {
    preference,
    effective,
    setPreference: setThemePreference,
  };
}
```

在 `packages/webview/src/index.tsx`：

1. 加 `import "@radix-ui/themes/styles.css";`
2. Window 类型加 `__MUSE_THEME_PREFERENCE__?: ThemePreference;`
3. `root.render` 包一层 `<MuseTheme>`：

```tsx
import { MuseTheme } from "./ui/theme";

root.render(
  <MuseTheme>
    {window.waveHostType === "desktop" ? (
      <DesktopApp vscode={vscode} />
    ) : (
      <ChatApp vscode={vscode} />
    )}
  </MuseTheme>,
);
```

`ChatApp.tsx`：删除 `state.theme` 的 `data-theme` `useEffect`（约 470–480 行）以及 `case "desktopThemeChange":` 里对 `data-theme` 的 `setAttribute`（约 770–775 行）。`desktopThemeChange` 分支改为 `break;` 即可（MuseTheme 自己听 `message`）。不要删 TerminalPane 里的同名处理。

MutationObserver 会看到 MuseTheme 自己写的 `data-theme`。当 preference 不是 `system` 时 `detectSystemDark` 的结果被 `resolveEffectiveTheme` 忽略，所以不会抖动。不要在 observer 回调里无条件 `setSystemDark` 造成固定主题被系统值覆盖——`resolveEffectiveTheme` 已保证这一点。

- [ ] **Step 5: 跑测试**

Run: `pnpm -F @muse-work/webview test tests/muse/themePreference.test.ts tests/muse/themeStorage.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/webview/package.json packages/webview/pnpm-lock.yaml packages/webview/src/ui/themePreference.ts packages/webview/src/ui/theme.tsx packages/webview/src/index.tsx packages/webview/src/components/ChatApp.tsx packages/webview/tests/muse/themePreference.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): wrap app in Radix MuseTheme and own data-theme

EOF
)"
```

若 lockfile 在仓库根目录，改为 `git add pnpm-lock.yaml`。

---

### Task 3: 桌面 `ui.json` + `nativeTheme` + preload 注入

**Files:**
- Create: `packages/desktop/src/main/uiPrefs.ts`
- Create: `packages/desktop/src/main/themeHost.ts`
- Create: `packages/desktop/tests/uiPrefs.test.ts`
- Modify: `packages/desktop/src/main/window.ts`
- Modify: `packages/desktop/src/main/preload.ts`
- Modify: `packages/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `ThemePreference` 字符串字面量（桌面不 import webview 包）
- Produces:
  - `export type ThemePreference = "system" | "light" | "dark"`
  - `export type EffectiveTheme = "light" | "dark"`
  - `export function getUiPrefsPath(home?: string): string`
  - `export function loadUiPrefs(home?: string): { version: 1; themePreference: ThemePreference }`
  - `export function saveUiPrefs(prefs: { version: 1; themePreference: ThemePreference }, home?: string): void`
  - `export function resolveEffectiveTheme(preference: ThemePreference, shouldUseDarkColors: boolean): EffectiveTheme`
  - `export function windowBackgroundFor(effective: EffectiveTheme): string` → light `#fcfcfc`，dark `#111111`
  - `export function installThemeHost(opts: { getWindow: () => BrowserWindow | null; nativeTheme: Electron.NativeTheme; ipc: Pick<typeof ipcMain, "on" | "removeListener">; home?: string }): { dispose: () => void; preference: ThemePreference; effective: EffectiveTheme }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getUiPrefsPath,
  loadUiPrefs,
  resolveEffectiveTheme,
  saveUiPrefs,
  windowBackgroundFor,
} from "../src/main/uiPrefs.js";

describe("uiPrefs", () => {
  it("defaults to system when the file is missing or corrupt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    expect(loadUiPrefs(home).themePreference).toBe("system");
    fs.mkdirSync(path.dirname(getUiPrefsPath(home)), { recursive: true });
    fs.writeFileSync(getUiPrefsPath(home), "{not json", "utf8");
    expect(loadUiPrefs(home).themePreference).toBe("system");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("round-trips a preference and maps window background", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    saveUiPrefs({ version: 1, themePreference: "light" }, home);
    expect(loadUiPrefs(home).themePreference).toBe("light");
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(windowBackgroundFor("light")).toBe("#fcfcfc");
    expect(windowBackgroundFor("dark")).toBe("#111111");
    fs.rmSync(home, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/desktop test tests/uiPrefs.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `uiPrefs.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";
export type UiPrefsFile = {
  version: 1;
  themePreference: ThemePreference;
};

export function getUiPrefsPath(home = os.homedir()): string {
  return path.join(home, ".muse-work", "ui.json");
}

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function loadUiPrefs(home = os.homedir()): UiPrefsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(getUiPrefsPath(home), "utf8")) as {
      themePreference?: unknown;
    };
    if (isPreference(raw.themePreference)) {
      return { version: 1, themePreference: raw.themePreference };
    }
  } catch {
    // missing or corrupt
  }
  return { version: 1, themePreference: "system" };
}

export function saveUiPrefs(prefs: UiPrefsFile, home = os.homedir()): void {
  const file = getUiPrefsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(prefs, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  shouldUseDarkColors: boolean,
): EffectiveTheme {
  if (preference === "light" || preference === "dark") return preference;
  return shouldUseDarkColors ? "dark" : "light";
}

export function windowBackgroundFor(effective: EffectiveTheme): string {
  return effective === "light" ? "#fcfcfc" : "#111111";
}
```

- [ ] **Step 4: 实现 `themeHost.ts` 并接到 main / window / preload**

`themeHost.ts` 要点：

```ts
import { BrowserWindow, ipcMain, nativeTheme as electronNativeTheme } from "electron";
import { FROM_WEBVIEW, TO_WEBVIEW } from "./workdirHost.js";
import {
  loadUiPrefs,
  resolveEffectiveTheme,
  saveUiPrefs,
  windowBackgroundFor,
  type ThemePreference,
} from "./uiPrefs.js";

export function installThemeHost(opts: {
  getWindow: () => BrowserWindow | null;
  nativeTheme?: typeof electronNativeTheme;
  ipc?: Pick<typeof ipcMain, "on" | "removeListener">;
  home?: string;
}) {
  const nativeTheme = opts.nativeTheme ?? electronNativeTheme;
  const ipc = opts.ipc ?? ipcMain;
  let preference = loadUiPrefs(opts.home).themePreference;
  nativeTheme.themeSource = preference;

  const effective = () =>
    resolveEffectiveTheme(preference, nativeTheme.shouldUseDarkColors);

  const paint = () => {
    const win = opts.getWindow();
    win?.setBackgroundColor(windowBackgroundFor(effective()));
    win?.webContents.send(TO_WEBVIEW, {
      command: "desktopThemeChange",
      effective: effective(),
    });
  };

  const onIpc = (_event: unknown, message: unknown) => {
    const msg = message as { command?: string; preference?: string };
    if (msg?.command !== "desktopSetThemePreference") return;
    if (msg.preference !== "system" && msg.preference !== "light" && msg.preference !== "dark") {
      return;
    }
    preference = msg.preference as ThemePreference;
    saveUiPrefs({ version: 1, themePreference: preference }, opts.home);
    nativeTheme.themeSource = preference;
    paint();
  };

  ipc.on(FROM_WEBVIEW, onIpc);
  nativeTheme.on("updated", paint);

  return {
    get preference() {
      return preference;
    },
    get effective() {
      return effective();
    },
    dispose: () => {
      ipc.removeListener(FROM_WEBVIEW, onIpc);
      nativeTheme.off("updated", paint);
    },
  };
}
```

`window.ts`：`CreateMainWindowOpts` 增加 `themePreference` 与 `backgroundColor`。`additionalArguments` 追加 `--muse-theme-preference=${opts.themePreference}`。`backgroundColor` 用传入值，不再写死 `#1e1e1e`。

`preload.ts`：

```ts
function readArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const themePreference = readArg("--muse-theme-preference=") ?? "system";
contextBridge.exposeInMainWorld("__MUSE_THEME_PREFERENCE__", themePreference);

function applyBootTheme(): void {
  const dark =
    themePreference === "dark" ||
    (themePreference === "system" &&
      globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const effective = themePreference === "light" ? "light" : dark ? "dark" : "light";
  document.documentElement?.setAttribute("data-theme", effective);
}
applyBootTheme();
document.addEventListener("DOMContentLoaded", applyBootTheme);
```

`index.ts`：在 `createMainWindow` 之前 `installThemeHost`，把 `themeHost.preference` 与 `windowBackgroundFor(themeHost.effective)` 传入 `createMainWindow`。`before-quit` 里 `themeHost.dispose()`。

- [ ] **Step 5: 跑测试**

Run: `pnpm -F @muse-work/desktop test tests/uiPrefs.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/uiPrefs.ts packages/desktop/src/main/themeHost.ts packages/desktop/src/main/window.ts packages/desktop/src/main/preload.ts packages/desktop/src/main/index.ts packages/desktop/tests/uiPrefs.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): persist theme preference and drive nativeTheme

EOF
)"
```

---

### Task 4: 设置页外观 tab + `Field` + `AppearanceSettings`

**Files:**
- Create: `packages/webview/src/ui/Field.tsx`
- Create: `packages/webview/src/components/AppearanceSettings.tsx`
- Create: `packages/webview/tests/components/appearanceSettings.test.tsx`
- Create: `packages/webview/tests/components/configDialog.appearance.test.tsx`
- Modify: `packages/webview/src/components/ConfigDialog.tsx`

**Interfaces:**
- Consumes: `useMuseTheme()` / `setThemePreference`
- Produces: `AppearanceSettings`；`ConfigDialog` 标题「设置」，tabs `外观` / `供应商`

- [ ] **Step 1: 写失败测试**

`appearanceSettings.test.tsx` 顶部加 `/** @vitest-environment jsdom */`。用 `vi.mock("../../src/ui/themePreference", ...)` 注入可控 `setThemePreference`，或直接用真实 store + 内存 localStorage。

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppearanceSettings } from "../../src/components/AppearanceSettings";
import { MuseTheme } from "../../src/ui/theme";
import { setThemePreference } from "../../src/ui/themePreference";

describe("AppearanceSettings", () => {
  beforeEach(() => {
    cleanup();
    const memory = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
      },
    });
    setThemePreference("system");
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies dark immediately without a save button", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );
    fireEvent.click(screen.getByRole("button", { name: /深色/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /跟随系统/ }));
    expect(screen.getByRole("button", { name: /跟随系统/ }).getAttribute("aria-pressed")).toBe("true");
  });
});
```

`configDialog.appearance.test.tsx`：mock `MuseProviderSettings`（照抄 `tests/webview/configDialog.test.tsx` 的 mock），断言：

- heading 「设置」
- tab 「外观」「供应商」
- 默认可见外观卡片
- 点「供应商」后出现 `muse-provider-settings`
- 改主题不调用 mock `isDirty` 变 true（mock 保持 `isDirty: () => false`）
- 供应商 dirty 时点关闭仍 `window.confirm`（把 mock `isDirty` 改成 `() => true` 并 spy `window.confirm`）

同时把 `tests/webview/configDialog.test.tsx` 里 heading `"供应商设置"` 改成 `"设置"`，避免以后 include 时失败。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/webview test tests/components/appearanceSettings.test.tsx tests/components/configDialog.appearance.test.tsx`

Expected: FAIL，组件不存在或 heading 仍是「供应商设置」。

- [ ] **Step 3: 实现 Field、AppearanceSettings、ConfigDialog tabs**

`Field.tsx`：

```tsx
import React from "react";
import { Flex, Text } from "@radix-ui/themes";

export function Field(props: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text as="label" size="2" weight="medium" htmlFor={props.htmlFor}>
        {props.label}
      </Text>
      {props.children}
      {props.error ? (
        <Text size="1" color="red">
          {props.error}
        </Text>
      ) : null}
      {props.hint && !props.error ? (
        <Text size="1" color="gray">
          {props.hint}
        </Text>
      ) : null}
    </Flex>
  );
}
```

`AppearanceSettings.tsx`：三张 `button`（`aria-pressed`），文案「跟随系统 / 浅色 / 深色」，hint「未设置时跟随操作系统。切换立即生效，无需点保存。」`data-testid="appearance-settings"`。点击调用 `useMuseTheme().setPreference`。

`ConfigDialog.tsx`：

- heading 改为「设置」
- 用本地 `useState<"appearance" | "provider">("appearance")`
- 两个 `role="tab"`：外观、供应商；`aria-selected`
- appearance 面板渲染 `<AppearanceSettings />`
- provider 面板仍是 `<MuseProviderSettings ref={settingsRef} />`
- 页脚按钮文案保持「关闭」「保存」；保存仍只 `settingsRef.current.save()`
- dirty 关闭逻辑不变，只看供应商 `isDirty()`

这一 task **先不要**上 `motion` / Radix Dialog，保持现有 overlay DOM，避免和下一个动效 task 缠在一起。保留 `data-testid="config-dialog"` 与 `data-testid="config-dialog-save"`。

- [ ] **Step 4: 跑测试**

Run: `pnpm -F @muse-work/webview test tests/components/appearanceSettings.test.tsx tests/components/configDialog.appearance.test.tsx tests/muse/museProviderSettings.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/ui/Field.tsx packages/webview/src/components/AppearanceSettings.tsx packages/webview/src/components/ConfigDialog.tsx packages/webview/tests/components/appearanceSettings.test.tsx packages/webview/tests/components/configDialog.appearance.test.tsx packages/webview/tests/webview/configDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): add appearance tab to settings

EOF
)"
```

---

### Task 5: 供应商表单换 Radix 控件

**Files:**
- Modify: `packages/webview/src/components/MuseProviderSettings.tsx`
- Modify: `packages/webview/tests/muse/museProviderSettings.test.tsx`（若 Select 不再是 native `change`）

**Interfaces:**
- Consumes: `Field`；`@radix-ui/themes` 的 `TextField`、`Select`、`TextArea`、`Progress`
- Produces: 同一 `save` / `isDirty`；同一 `id` / `data-testid`（`muse-provider`、`muse-openai-form`、`muse-codemaker-quota`、`muse-quota-progress`）

- [ ] **Step 1: 跑现有测试做基线**

Run: `pnpm -F @muse-work/webview test tests/muse/museProviderSettings.test.tsx`

Expected: PASS（尚未改实现）。

- [ ] **Step 2: 换成 Radix，必要时改测试交互**

用 `Field` 包每一项。

- Provider：`Select.Root` + `Select.Trigger`（保留 `id="muse-provider"` 或 `aria-label="AI 供应商 (Provider)"`）+ `Select.Content` / `Select.Item`
- API URL / API Key：`TextField.Root`
- Models：`TextArea`
- CodeMaker 额度：Radix `Progress` 替换自制 bar，保留 `data-testid="muse-quota-progress"`

保存 / 解析 / `notifyProvidersChanged` 一行都不许改语义。

若 Testing Library 的 `fireEvent.change` 对 Radix Select 无效，把该测试改成 `@testing-library/user-event`：click trigger → click `OpenAI Compatible`。URL / Key / textarea 仍可用 `fireEvent.change` 或 `userEvent.type`。

包一层 `MuseTheme` 再 `render`，否则 Radix 缺 Theme 会警告。

- [ ] **Step 3: 跑测试**

Run: `pnpm -F @muse-work/webview test tests/muse/museProviderSettings.test.tsx tests/components/configDialog.appearance.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/webview/src/components/MuseProviderSettings.tsx packages/webview/tests/muse/museProviderSettings.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): restyle provider settings with Radix form controls

EOF
)"
```

---

### Task 6: Dialog / Tab 动效（`motion`）

**Files:**
- Modify: `packages/webview/src/components/ConfigDialog.tsx`
- Modify: `packages/webview/tests/components/configDialog.appearance.test.tsx`（Escape / overlay 行为保持）

**Interfaces:**
- Consumes: `motion` from `motion/react`；现有 `requestClose` / dirty confirm
- Produces: 同一关闭语义；`prefers-reduced-motion: reduce` 时 duration 0、无 scale

- [ ] **Step 1: 给 overlay / 面板加上 motion，Tab 下划线用 `layoutId`**

遮罩：

```tsx
import { motion } from "motion/react";

const reduce =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const panelTransition = reduce
  ? { duration: 0 }
  : { type: "spring" as const, stiffness: 380, damping: 28 };
```

面板：

```tsx
<motion.div
  className="configuration-dialog config-dialog"
  data-testid="config-dialog"
  initial={reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={panelTransition}
>
```

Tab 下划线：当前 tab 内渲染

```tsx
<motion.span layoutId="settings-tab-underline" style={{ /* 2px accent bar */ }} />
```

不要换 Radix Dialog 的 focus trap 除非现有 outside-click / Escape 测试全绿。优先保留现有 overlay 节点，只加 motion。

- [ ] **Step 2: 跑测试**

Run: `pnpm -F @muse-work/webview test tests/components/configDialog.appearance.test.tsx tests/muse/museProviderSettings.test.tsx`

Expected: PASS。Escape、延迟 outside click、保存关闭仍成立。

- [ ] **Step 3: Commit**

```bash
git add packages/webview/src/components/ConfigDialog.tsx packages/webview/tests/components/configDialog.appearance.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): spring-animate settings dialog and tab underline

EOF
)"
```

---

### Task 7: 应用页 chrome 换 Radix token

**Files:**
- Modify: `packages/webview/src/styles/DesktopApp.css`
- Modify: `packages/webview/src/styles/ChatHeader.css`
- Modify: `packages/webview/src/styles/Message.css`
- Modify: `packages/webview/src/styles/MessageList.css`
- Modify: `packages/webview/src/styles/MessageInput.css`
- Modify: `packages/webview/src/styles/ChatApp.css`（`.chat-container` 背景）

**Interfaces:**
- Consumes: Radix CSS 变量（`Theme` 已在根上）
- Produces: 视觉与原型一致；选择器 / class 名不变

- [ ] **Step 1: 按表替换，不改 DOM**

| 文件 | 选择器 | 改为 |
|---|---|---|
| DesktopApp.css | `.desktop-sidebar` background | `var(--gray-2)` |
| DesktopApp.css | `.desktop-sidebar` / footer / header 边框 | `var(--gray-6)` |
| DesktopApp.css | `.desktop-session-item:hover` / `.desktop-sidebar-new-chat:hover` | `var(--gray-4)` |
| DesktopApp.css | `.desktop-session-item--current` | background `var(--gray-4)`，color inherit |
| DesktopApp.css | `.desktop-session-unread-dot` | `var(--accent-9)` |
| DesktopApp.css | 圆角 4px 的 item / button | `var(--radius-2)` |
| ChatHeader.css | `.chat-header` border | `var(--gray-6)`；height 保持 35–36px |
| ChatHeader.css | `.header-button:hover` | `var(--gray-4)` |
| Message.css | `.user-text-block` | background `var(--gray-3)`；radius `var(--radius-3)` |
| Message.css | timeline 点 | `var(--gray-8)` |
| MessageList.css | `.messages-container` / sticky 背景 | `var(--color-background)`；sticky 不要再用 gradient scrim 若能改成 `var(--color-background)` 实底 |
| MessageInput.css | `.input-content` border | `var(--gray-6)`；radius `var(--radius-3)` |
| MessageInput.css | `.input-content:focus-within` | `var(--accent-9)`，去掉 `#c1292e` fallback |
| MessageInput.css | `.ai-send-btn` | background `var(--accent-9)`；radius `var(--radius-2)`；hover `var(--accent-10)` |
| ChatApp.css | `.chat-container` / `.input-area-container` | `var(--color-background)` |

不要改 240px 侧栏宽度、800px 消息列、composer 工具行结构。

- [ ] **Step 2: 跑相关 UI 测试**

Run: `pnpm -F @muse-work/webview test tests/components/DesktopSidebar.sessions.test.tsx tests/muse/museProviderSettings.test.tsx tests/components/configDialog.appearance.test.tsx`

Expected: PASS（纯 CSS，逻辑测试不应红）。

- [ ] **Step 3: Commit**

```bash
git add packages/webview/src/styles/DesktopApp.css packages/webview/src/styles/ChatHeader.css packages/webview/src/styles/Message.css packages/webview/src/styles/MessageList.css packages/webview/src/styles/MessageInput.css packages/webview/src/styles/ChatApp.css
git commit -m "$(cat <<'EOF'
feat(webview): map app chrome colors to Radix theme tokens

EOF
)"
```

---

### Task 8: 清掉表单旧皮肤并核对测试

**Files:**
- Modify: `packages/webview/src/styles/ConfigurationDialog.css`（删除 `.configuration-field input/select/textarea` 的 vscode 皮肤，避免盖住 Radix）
- Modify: `packages/webview/src/utils/theme.ts` 顶部注释（说明 desktop 现有 in-app preference）
- Modify: 任何仍写 FR-016「无应用内偏好」的注释

**Interfaces:**
- Consumes: Task 4–5 已改用 Radix
- Produces: 表单视觉只走 Radix；Diff / Terminal 仍用 `--vscode-*`

- [ ] **Step 1: 删除 ConfigurationDialog.css 里针对 input/select/textarea 的 background/border/focus 规则**（约 `.configuration-field input, .configuration-field select, .configuration-field textarea` 那一段）。保留 overlay / header / footer 布局，直到完全不需要。把 `.config-dialog .configuration-save-btn` 改成不覆盖 Radix `Button`——若 Task 4 仍用原生 footer button，则改 footer 为：

```tsx
import { Button } from "@radix-ui/themes";
<Button variant="soft" color="gray" onClick={requestClose}>关闭</Button>
<Button onClick={() => void handleSave()} data-testid="config-dialog-save">保存</Button>
```

主按钮走 accent red。

- [ ] **Step 2: 全量 webview + desktop 测试**

Run:

```bash
pnpm -F @muse-work/webview test
pnpm -F @muse-work/desktop test
pnpm -F @muse-work/webview type-check
pnpm -F @muse-work/desktop type-check
```

Expected: 全部 PASS / `tsc` 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/webview/src/styles/ConfigurationDialog.css packages/webview/src/utils/theme.ts packages/webview/src/components/ConfigDialog.tsx
git commit -m "$(cat <<'EOF'
refactor(webview): drop legacy form control styles in settings

EOF
)"
```

---

## Spec coverage

| Spec 节 | Task |
|---|---|
| §4 主题模型 / appearance 不传 inherit | 1, 2 |
| §5 localStorage + ui.json + nativeTheme + preload + desktopThemeChange 仅 system 时采纳 | 2, 3 |
| §6 MuseTheme / Field / 目录 | 2, 4 |
| §7 设置页 tabs、立即生效、dirty 关闭 | 4, 5 |
| §7 Dialog 弹簧 + reduced motion | 6 |
| §8 应用页 chrome token | 7 |
| §9 Tab 下划线 | 6 |
| §10 损坏 ui.json / 无 localStorage | 1, 3 |
| §11 测试清单 | 1, 2, 4, 5 |
| §12 顺序 | Task 1→8 |
| 不改会话/分屏/保存语义 | 5 明确禁止改 save 逻辑；7 只改 CSS |
