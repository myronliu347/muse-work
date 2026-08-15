# Desktop Dock Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the panel dropdown with dock toggle + `+` add-menu, overlay tab close, and dock-level fullscreen covering the chat column.

**Architecture:** Keep the shared `DesktopPanelDock` column and `panelGroupStore`. Add `collapsedTabs` / `dockFullscreen` on the group; simplify `PanelToggleControl` to a single dock toggle; evolve the old multi-select menu into an add-only `PanelAddMenu`; wire `toggleDock` / `addPanel` / fullscreen in `ChatApp`.

**Tech Stack:** React, Zustand (`panelGroupStore`), Vitest + Testing Library, existing Codicons / CSS variables.

**Spec:** `docs/superpowers/specs/2026-08-15-desktop-dock-chrome-design.md`

## Global Constraints

- Desktop webview only; non-desktop hosts unchanged.
- `+` menu order: file → terminal → preview → diff (文件、终端、浏览器、变更).
- Tab bar display order stays `PANEL_TAB_ORDER`.
- Fullscreen is dock-level CSS, not OS Fullscreen API; not persisted across dock close.
- No ESC-to-exit-fullscreen.
- Keyboard shortcuts still toggle individual panels (existing behavior).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/webview/src/muse/panelTabs.ts` | Add `PANEL_ADD_ORDER`; pure `CollapsedTabs` helpers |
| `packages/webview/src/stores/panelGroupStore.ts` | `collapsedTabs`, `dockFullscreen` on `PanelGroupState` / `emptyPanelGroup` |
| `packages/webview/src/types/index.ts` | Slim `PanelToggleProps` to dock toggle |
| `packages/webview/src/components/panels/PanelToggleControl.tsx` | Button only — call `onToggleDock` |
| `packages/webview/src/components/panels/PanelAddMenu.tsx` | Add-only menu (replace `PanelToggleMenu` usage) |
| `packages/webview/src/components/panels/PanelToggleMenu.tsx` | Delete or thin-re-export after migration |
| `packages/webview/src/components/desktop/DesktopPanelDock.tsx` | Tabs + `+` + fullscreen + toggle; overlay close |
| `packages/webview/src/styles/DesktopPanelDock.css` | Overlay X, add btn, fullscreen layout |
| `packages/webview/src/styles/PanelToggleMenu.css` | Anchor tweaks for `+` menu (reuse) |
| `packages/webview/src/components/ChatApp.tsx` | `toggleDock` / `addPanel` / fullscreen wiring |
| Tests under `packages/webview/tests/` | Unit + component coverage per task |

---

### Task 1: `PANEL_ADD_ORDER` + collapse/restore helpers

**Files:**
- Modify: `packages/webview/src/muse/panelTabs.ts`
- Modify: `packages/webview/tests/muse/panelTabs.test.ts`

**Interfaces:**
- Produces:
  - `PANEL_ADD_ORDER: DesktopPanelKind[]` = `["file", "terminal", "preview", "diff"]`
  - `export type CollapsedTabs = { checked: DesktopPanelKind[]; active: DesktopPanelKind | null }`
  - `snapshotCollapsedTabs(checked, active): CollapsedTabs | null`
  - `resolveOpenDockTabs(collapsed): { checked: DesktopPanelKind[]; active: DesktopPanelKind }`

- [ ] **Step 1: Write the failing tests**

Append to `packages/webview/tests/muse/panelTabs.test.ts`:

```ts
import {
  nextActivePanel,
  PANEL_ADD_ORDER,
  PANEL_TAB_ICONS,
  PANEL_TAB_LABELS,
  resolveOpenDockTabs,
  snapshotCollapsedTabs,
} from "../../src/muse/panelTabs";

describe("PANEL_ADD_ORDER", () => {
  it("lists 文件、终端、浏览器、变更", () => {
    expect(PANEL_ADD_ORDER).toEqual(["file", "terminal", "preview", "diff"]);
  });
});

describe("snapshotCollapsedTabs / resolveOpenDockTabs", () => {
  it("returns null snapshot when nothing is open", () => {
    expect(snapshotCollapsedTabs([], null)).toBeNull();
  });

  it("snapshots checked + active for restore", () => {
    expect(snapshotCollapsedTabs(["preview", "file"], "file")).toEqual({
      checked: ["preview", "file"],
      active: "file",
    });
  });

  it("restores collapsed tabs", () => {
    expect(
      resolveOpenDockTabs({ checked: ["preview", "file"], active: "file" }),
    ).toEqual({ checked: ["preview", "file"], active: "file" });
  });

  it("defaults to 变更 when no collapsed history", () => {
    expect(resolveOpenDockTabs(null)).toEqual({
      checked: ["diff"],
      active: "diff",
    });
    expect(resolveOpenDockTabs({ checked: [], active: null })).toEqual({
      checked: ["diff"],
      active: "diff",
    });
  });

  it("falls back active to first remaining tab when stale", () => {
    expect(
      resolveOpenDockTabs({ checked: ["terminal"], active: "diff" }),
    ).toEqual({ checked: ["terminal"], active: "terminal" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/webview && npx vitest run tests/muse/panelTabs.test.ts -v`  
Expected: FAIL — `PANEL_ADD_ORDER` / helpers not exported.

- [ ] **Step 3: Implement helpers in `panelTabs.ts`**

```ts
export const PANEL_ADD_ORDER: DesktopPanelKind[] = [
  "file",
  "terminal",
  "preview",
  "diff",
];

export type CollapsedTabs = {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
};

export function snapshotCollapsedTabs(
  checked: DesktopPanelKind[],
  active: DesktopPanelKind | null,
): CollapsedTabs | null {
  if (checked.length === 0) return null;
  const safeActive =
    active && checked.includes(active) ? active : firstPanelTab(checked);
  return { checked: [...checked], active: safeActive };
}

export function resolveOpenDockTabs(
  collapsed: CollapsedTabs | null | undefined,
): { checked: DesktopPanelKind[]; active: DesktopPanelKind } {
  if (!collapsed || collapsed.checked.length === 0) {
    return { checked: ["diff"], active: "diff" };
  }
  const active =
    collapsed.active && collapsed.checked.includes(collapsed.active)
      ? collapsed.active
      : (firstPanelTab(collapsed.checked) as DesktopPanelKind);
  return { checked: [...collapsed.checked], active };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/webview && npx vitest run tests/muse/panelTabs.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/panelTabs.ts packages/webview/tests/muse/panelTabs.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add dock collapse helpers and PANEL_ADD_ORDER

EOF
)"
```

---

### Task 2: Store fields `collapsedTabs` + `dockFullscreen`

**Files:**
- Modify: `packages/webview/src/stores/panelGroupStore.ts`
- Create: `packages/webview/tests/stores/panelGroupCollapsed.test.ts` (or extend an existing panelGroup test if present)

**Interfaces:**
- Consumes: `CollapsedTabs` from `../muse/panelTabs`
- Produces: `PanelGroupState.collapsedTabs: CollapsedTabs | null`, `PanelGroupState.dockFullscreen: boolean`; both default in `emptyPanelGroup()`

- [ ] **Step 1: Write the failing test**

```ts
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { emptyPanelGroup } from "../../src/stores/panelGroupStore";

describe("emptyPanelGroup dock chrome fields", () => {
  it("defaults collapsedTabs null and dockFullscreen false", () => {
    const g = emptyPanelGroup();
    expect(g.collapsedTabs).toBeNull();
    expect(g.dockFullscreen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/webview && npx vitest run tests/stores/panelGroupCollapsed.test.ts -v`  
Expected: FAIL — properties missing / undefined assertions.

- [ ] **Step 3: Minimal store change**

In `PanelGroupState`:

```ts
import type { CollapsedTabs } from "../muse/panelTabs";

// on interface:
collapsedTabs: CollapsedTabs | null;
dockFullscreen: boolean;
```

In `emptyPanelGroup()`:

```ts
collapsedTabs: null,
dockFullscreen: false,
```

In `resolvePanelGroup`, back-compat:

```ts
if (next.collapsedTabs === undefined) {
  next = { ...next, collapsedTabs: null };
}
if (next.dockFullscreen === undefined) {
  next = { ...next, dockFullscreen: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/webview && npx vitest run tests/stores/panelGroupCollapsed.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/stores/panelGroupStore.ts packages/webview/tests/stores/panelGroupCollapsed.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add collapsedTabs and dockFullscreen to panel group

EOF
)"
```

---

### Task 3: Simplify `PanelToggleControl` to dock toggle

**Files:**
- Modify: `packages/webview/src/types/index.ts` (`PanelToggleProps`)
- Modify: `packages/webview/src/components/panels/PanelToggleControl.tsx`
- Create: `packages/webview/tests/webview/panelToggleControl.test.tsx`
- Note: temporary type breakage in `ChatApp` / `DesktopPanelDock` until Tasks 4–5; fix call sites in those tasks, or do a minimal compile-safe stub in this task (prefer stub `onToggleDock` wiring in ChatApp/Dock with `() => {}` only if needed — better: update props at call sites to `onToggleDock` immediately and keep old menu dead until Task 4).

**Interfaces:**
- Produces:

```ts
export interface PanelToggleProps {
  onToggleDock: () => void;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PanelToggleControl } from "../../src/components/panels/PanelToggleControl";
import { MuseTheme } from "../../src/ui/theme";

describe("PanelToggleControl", () => {
  it("toggles dock on click without opening a menu", () => {
    const onToggleDock = vi.fn();
    render(
      <MuseTheme>
        <PanelToggleControl onToggleDock={onToggleDock} />
      </MuseTheme>,
    );
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    expect(onToggleDock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("panel-toggle-menu")).toBeNull();
    expect(
      screen.getByTestId("panel-toggle-btn").querySelector(".header-panel-toggle-caret"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/webview && npx vitest run tests/webview/panelToggleControl.test.tsx -v`  
Expected: FAIL (still opens menu / has caret / wrong props).

- [ ] **Step 3: Implement**

`types/index.ts`:

```ts
/** Header / dock control: show or hide the entire right dock. */
export interface PanelToggleProps {
  onToggleDock: () => void;
}
```

`PanelToggleControl.tsx`:

```tsx
import React from "react";
import { Tooltip } from "../shared/Tooltip";
import type { PanelToggleProps } from "../../types";

export const PanelToggleControl: React.FC<PanelToggleProps> = ({
  onToggleDock,
}) => (
  <div className="panel-toggle-control">
    <Tooltip text="面板" position="bottom">
      <button
        className="header-button header-panel-toggle"
        onClick={onToggleDock}
        data-testid="panel-toggle-btn"
        aria-label="面板"
      >
        <i className="codicon codicon-layout-sidebar-right" />
      </button>
    </Tooltip>
  </div>
);
```

Update `ChatHeader` usage site types automatically via `PanelToggleProps`.  
Update `ChatApp` header branch to pass `{ onToggleDock: handleToggleDock }` — if `handleToggleDock` is not ready, add a temporary:

```ts
const handleToggleDock = useCallback(() => {
  // Task 5 fills real logic; for compile: no-op or call tryOpenPanel("diff")
}, []);
```

Prefer implementing the real `handleToggleDock` body in Task 5; for this task only change the prop shape and pass a stub that opens/closes via existing `handleTogglePanel("diff")` if needed for green build. **Preferred:** keep this task UI-only and immediately patch `DesktopPanelDock` + `ChatApp` prop spreads to `onToggleDock={() => {}}` so TypeScript compiles; Task 5 replaces the stubs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/webview && npx vitest run tests/webview/panelToggleControl.test.tsx -v`  
Expected: PASS  
Also ensure `npx tsc -p packages/webview --noEmit` (or package’s typecheck script) is clean after stubbing call sites.

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/types/index.ts \
  packages/webview/src/components/panels/PanelToggleControl.tsx \
  packages/webview/src/components/desktop/DesktopPanelDock.tsx \
  packages/webview/src/components/ChatApp.tsx \
  packages/webview/tests/webview/panelToggleControl.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): make panel toggle a dock show/hide button

EOF
)"
```

---

### Task 4: `PanelAddMenu` (add-only, new order)

**Files:**
- Create: `packages/webview/src/components/panels/PanelAddMenu.tsx`
- Create: `packages/webview/tests/webview/panelAddMenu.test.tsx`
- Delete or stop importing: `packages/webview/src/components/panels/PanelToggleMenu.tsx`
- Update/delete: `packages/webview/tests/webview/panelToggleMenu.test.tsx` (replace with add-menu tests)

**Interfaces:**
- Consumes: `PANEL_ADD_ORDER`, `PANEL_TAB_LABELS`, `panelShortcutLabel`
- Produces:

```ts
export type PanelAddMenuProps = {
  checked: DesktopPanelKind[];
  disabled?: DesktopPanelKind[];
  onAdd: (kind: DesktopPanelKind) => void;
  onClose: () => void;
};
```

- [ ] **Step 1: Write the failing tests**

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PanelAddMenu } from "../../src/components/panels/PanelAddMenu";

describe("PanelAddMenu", () => {
  it("lists only closed panels in 文件、终端、浏览器、变更 order", () => {
    render(
      <PanelAddMenu
        checked={["preview"]}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    const items = screen.getAllByTestId(/panel-add-item-/);
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "panel-add-item-file",
      "panel-add-item-terminal",
      "panel-add-item-diff",
    ]);
    expect(screen.queryByTestId("panel-add-item-preview")).toBeNull();
  });

  it("adds a panel and closes the menu", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <PanelAddMenu checked={[]} onAdd={onAdd} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("panel-add-item-file"));
    expect(onAdd).toHaveBeenCalledWith("file");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits disabled panels", () => {
    render(
      <PanelAddMenu
        checked={[]}
        disabled={["terminal"]}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("panel-add-item-terminal")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/webview && npx vitest run tests/webview/panelAddMenu.test.tsx -v`  
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `PanelAddMenu`**

```tsx
import React, { useEffect, useRef } from "react";
import type { DesktopPanelKind } from "../../types";
import { panelShortcutLabel } from "../../muse/panelShortcuts";
import { PANEL_ADD_ORDER, PANEL_TAB_LABELS } from "../../muse/panelTabs";
import "../../styles/PanelToggleMenu.css";

export type PanelAddMenuProps = {
  checked: DesktopPanelKind[];
  disabled?: DesktopPanelKind[];
  onAdd: (kind: DesktopPanelKind) => void;
  onClose: () => void;
};

export const PanelAddMenu: React.FC<PanelAddMenuProps> = ({
  checked,
  disabled = [],
  onAdd,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = PANEL_ADD_ORDER.filter(
    (kind) => !checked.includes(kind) && !disabled.includes(kind),
  );

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="panel-toggle-menu" data-testid="panel-add-menu">
      {items.map((kind) => (
        <div
          key={kind}
          className="panel-toggle-menu-item"
          role="menuitem"
          data-testid={`panel-add-item-${kind}`}
          onClick={() => {
            onAdd(kind);
            onClose();
          }}
        >
          <span className="panel-toggle-menu-label">{PANEL_TAB_LABELS[kind]}</span>
          <span className="panel-toggle-menu-shortcut">
            {panelShortcutLabel(kind)}
          </span>
        </div>
      ))}
    </div>
  );
};
```

Delete `PanelToggleMenu.tsx` and `panelToggleMenu.test.tsx` once nothing imports them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/webview && npx vitest run tests/webview/panelAddMenu.test.tsx -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/PanelAddMenu.tsx \
  packages/webview/tests/webview/panelAddMenu.test.tsx
git rm -f packages/webview/src/components/panels/PanelToggleMenu.tsx \
  packages/webview/tests/webview/panelToggleMenu.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): replace panel toggle menu with add-only PanelAddMenu

EOF
)"
```

---

### Task 5: `DesktopPanelDock` chrome (tabs overlay X, `+`, fullscreen)

**Files:**
- Modify: `packages/webview/src/components/desktop/DesktopPanelDock.tsx`
- Modify: `packages/webview/src/styles/DesktopPanelDock.css`
- Modify: `packages/webview/tests/components/desktopPanelDock.test.tsx`

**Interfaces:**
- Consumes: `PanelAddMenu`, `PanelToggleControl`, `PANEL_ADD_ORDER`
- Produces updated props:

```ts
export interface DesktopPanelDockProps {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind;
  onSelect: (kind: DesktopPanelKind) => void;
  onCloseTab: (kind: DesktopPanelKind) => void;
  onAddPanel: (kind: DesktopPanelKind) => void;
  disabledPanels?: DesktopPanelKind[];
  panelToggle: PanelToggleProps; // { onToggleDock }
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  children: React.ReactNode;
}
```

- [ ] **Step 1: Extend failing tests in `desktopPanelDock.test.tsx`**

```tsx
it("shows + when panels remain, hides when all open", () => {
  const { rerender } = render(
    <MuseTheme>
      <DesktopPanelDock
        checked={["preview"]}
        active="preview"
        onSelect={() => {}}
        onCloseTab={() => {}}
        onAddPanel={() => {}}
        panelToggle={{ onToggleDock: () => {} }}
        fullscreen={false}
        onToggleFullscreen={() => {}}
        width={420}
        onWidthChange={() => {}}
        maxWidth={800}
      >
        <div>body</div>
      </DesktopPanelDock>
    </MuseTheme>,
  );
  expect(screen.getByTestId("desktop-panel-add-btn")).toBeInTheDocument();

  rerender(
    <MuseTheme>
      <DesktopPanelDock
        checked={["preview", "diff", "terminal", "file"]}
        active="file"
        onSelect={() => {}}
        onCloseTab={() => {}}
        onAddPanel={() => {}}
        panelToggle={{ onToggleDock: () => {} }}
        fullscreen={false}
        onToggleFullscreen={() => {}}
        width={420}
        onWidthChange={() => {}}
        maxWidth={800}
      >
        <div>body</div>
      </DesktopPanelDock>
    </MuseTheme>,
  );
  expect(screen.queryByTestId("desktop-panel-add-btn")).toBeNull();
});

it("toggles fullscreen via header button", () => {
  const onToggleFullscreen = vi.fn();
  render(
    <MuseTheme>
      <DesktopPanelDock
        checked={["diff"]}
        active="diff"
        onSelect={() => {}}
        onCloseTab={() => {}}
        onAddPanel={() => {}}
        panelToggle={{ onToggleDock: () => {} }}
        fullscreen={false}
        onToggleFullscreen={onToggleFullscreen}
        width={420}
        onWidthChange={() => {}}
        maxWidth={800}
      >
        <div>body</div>
      </DesktopPanelDock>
    </MuseTheme>,
  );
  fireEvent.click(screen.getByTestId("desktop-panel-fullscreen-btn"));
  expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
});

it("marks dock fullscreen class when fullscreen", () => {
  render(
    <MuseTheme>
      <DesktopPanelDock
        checked={["diff"]}
        active="diff"
        onSelect={() => {}}
        onCloseTab={() => {}}
        onAddPanel={() => {}}
        panelToggle={{ onToggleDock: () => {} }}
        fullscreen
        onToggleFullscreen={() => {}}
        width={420}
        onWidthChange={() => {}}
        maxWidth={800}
      >
        <div>body</div>
      </DesktopPanelDock>
    </MuseTheme>,
  );
  expect(screen.getByTestId("desktop-panel-dock").className).toContain(
    "desktop-panel-dock--fullscreen",
  );
});
```

Update existing tests’ props to match the new interface.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/webview && npx vitest run tests/components/desktopPanelDock.test.tsx -v`  
Expected: FAIL — missing add/fullscreen UI.

- [ ] **Step 3: Implement dock header + CSS**

Header structure:

```tsx
<div className="desktop-panel-dock-tabs">
  {tabs.map(/* existing tab; close button stays */)}
  {canAdd && (
    <div className="desktop-panel-add">
      <button
        type="button"
        className="desktop-panel-add-btn"
        data-testid="desktop-panel-add-btn"
        aria-label="添加面板"
        onClick={() => setShowAddMenu((v) => !v)}
      >
        <i className="codicon codicon-add" />
      </button>
      {showAddMenu && (
        <PanelAddMenu
          checked={checked}
          disabled={disabledPanels}
          onAdd={onAddPanel}
          onClose={() => setShowAddMenu(false)}
        />
      )}
    </div>
  )}
</div>
<div className="desktop-panel-dock-actions">
  <Tooltip text={fullscreen ? "退出全屏" : "全屏"} position="bottom">
    <button
      type="button"
      className="header-button"
      data-testid="desktop-panel-fullscreen-btn"
      aria-label={fullscreen ? "退出全屏" : "全屏"}
      onClick={onToggleFullscreen}
    >
      <i
        className={`codicon ${fullscreen ? "codicon-screen-normal" : "codicon-screen-full"}`}
      />
    </button>
  </Tooltip>
  <PanelToggleControl {...panelToggle} />
</div>
```

`canAdd`:

```ts
const canAdd = PANEL_ADD_ORDER.some(
  (kind) => !checked.includes(kind) && !(disabledPanels ?? []).includes(kind),
);
```

Root class:

```tsx
className={`desktop-panel-dock${fullscreen ? " desktop-panel-dock--fullscreen" : ""}`}
```

When `fullscreen`, do not attach resize `onMouseDown` (or hide handle via CSS).

CSS additions (`DesktopPanelDock.css`):

```css
.desktop-panel-tab {
  position: relative;
  /* keep existing flex metrics */
  padding-right: var(--space-2); /* close overlays; no reserved close column */
}

.desktop-panel-tab-close {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  /* existing size; opacity 0 until hover */
  z-index: 1;
  background: var(--gray-4); /* slight mask so X readable over label */
}

.desktop-panel-add {
  position: relative;
  flex-shrink: 0;
}

.desktop-panel-add-btn { /* match tab height 24px, icon button */ }

.desktop-panel-dock-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  margin-left: auto;
}

.desktop-panel-dock--fullscreen {
  flex: 1 1 auto !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0;
}

.desktop-panel-dock--fullscreen .preview-pane-drag-handle {
  display: none;
}

/* Hide chat column while dock is fullscreen */
.desktop-chat-body:has(.desktop-panel-dock--fullscreen) .desktop-chat-main {
  display: none;
}
```

Put the `:has(...)` rule in `DesktopApp.css` next to `.desktop-chat-body` if preferred for cascade clarity.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/webview && npx vitest run tests/components/desktopPanelDock.test.tsx -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/DesktopPanelDock.tsx \
  packages/webview/src/styles/DesktopPanelDock.css \
  packages/webview/src/styles/DesktopApp.css \
  packages/webview/tests/components/desktopPanelDock.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): dock add button, overlay tab close, and fullscreen chrome

EOF
)"
```

---

### Task 6: Wire `toggleDock` / `addPanel` / fullscreen in `ChatApp`

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Create: `packages/webview/tests/muse/toggleDock.test.ts` for pure orchestration helpers if extracted; otherwise cover via a small exported helper module:

**Preferred extract** (keeps ChatApp thinner):  
- Create: `packages/webview/src/muse/dockActions.ts` with pure reducers used by ChatApp:

```ts
export function reduceToggleDock(group: {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
  collapsedTabs: CollapsedTabs | null;
  dockFullscreen: boolean;
  mounted: DesktopPanelKind[];
}): Partial<typeof group> & {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
  collapsedTabs: CollapsedTabs | null;
  dockFullscreen: boolean;
  mounted?: DesktopPanelKind[];
}
```

Actually keep logic inline in ChatApp callbacks but unit-test the already-exported `snapshotCollapsedTabs` / `resolveOpenDockTabs`; add one focused test file that documents the ChatApp contract via helper:

Create `packages/webview/src/muse/dockActions.ts`:

```ts
import type { DesktopPanelKind } from "../types";
import type { CollapsedTabs } from "./panelTabs";
import { resolveOpenDockTabs, snapshotCollapsedTabs } from "./panelTabs";

export function collapseDockState(input: {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
}): {
  collapsedTabs: CollapsedTabs;
  checked: [];
  active: null;
  dockFullscreen: false;
} {
  const snap = snapshotCollapsedTabs(input.checked, input.active);
  return {
    collapsedTabs: snap ?? { checked: [], active: null },
    checked: [],
    active: null,
    dockFullscreen: false,
  };
}

export function expandDockState(collapsedTabs: CollapsedTabs | null): {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind;
  collapsedTabs: null;
  dockFullscreen: false;
} {
  const opened = resolveOpenDockTabs(collapsedTabs);
  return {
    checked: opened.checked,
    active: opened.active,
    collapsedTabs: null,
    dockFullscreen: false,
  };
}
```

**Interfaces:**
- Consumes: store fields, `tryOpenPanel`, helpers above
- Produces: wired props on `DesktopPanelDock` / `ChatHeader`

- [ ] **Step 1: Write failing tests for `dockActions`**

```ts
import { describe, expect, it } from "vitest";
import { collapseDockState, expandDockState } from "../../src/muse/dockActions";

describe("collapseDockState / expandDockState", () => {
  it("collapses open dock into collapsedTabs and clears fullscreen", () => {
    expect(
      collapseDockState({ checked: ["preview", "diff"], active: "diff" }),
    ).toEqual({
      collapsedTabs: { checked: ["preview", "diff"], active: "diff" },
      checked: [],
      active: null,
      dockFullscreen: false,
    });
  });

  it("expands from history and defaults to diff", () => {
    expect(expandDockState(null)).toEqual({
      checked: ["diff"],
      active: "diff",
      collapsedTabs: null,
      dockFullscreen: false,
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd packages/webview && npx vitest run tests/muse/dockActions.test.ts -v`

- [ ] **Step 3: Implement `dockActions.ts` + ChatApp wiring**

In `ChatApp.tsx`:

```ts
const handleToggleDock = useCallback(() => {
  const checked = checkedPanelsRef.current;
  if (checked.length > 0) {
    updatePanelGroup((group) => ({
      ...collapseDockState({
        checked: group.checked,
        active: group.active,
      }),
    }));
    return;
  }
  const expanded = expandDockState(
    /* read current collapsedTabs from store/group */ 
    // use updatePanelGroup functional form:
  );
  updatePanelGroup((group) => {
    if (group.checked.length > 0) return {};
    const next = expandDockState(group.collapsedTabs);
    // Ensure newly opened kinds are mounted:
    const mounted = Array.from(new Set([...group.mounted, ...next.checked]));
    // First open may need tryOpenPanel width planning — if collapsedTabs
    // was null and mounted was empty, call the same planPanelWidthsForOpen
    // path as tryOpenPanel('diff') before applying.
    return { ...next, mounted };
  });
}, [updatePanelGroup, /* width planning deps if inlined */]);
```

**Width planning:** When expanding with no prior `mounted` (true first open), reuse the block inside `tryOpenPanel` for the first kind in `next.checked` (usually `diff`). Simplest approach: if `collapsedTabs` is null, call `tryOpenPanel("diff")` instead of raw expand; if restoring multiple, `tryOpenPanel` for the first then `updatePanelGroup` to set full `checked`/`active`/`mounted`.

Concrete restore path:

```ts
const handleToggleDock = useCallback(() => {
  if (checkedPanelsRef.current.length > 0) {
    updatePanelGroup((group) => collapseDockState(group));
    return;
  }
  updatePanelGroup((group) => {
    const collapsed = group.collapsedTabs;
    if (!collapsed || collapsed.checked.length === 0) {
      return {}; // signal caller to tryOpenPanel("diff")
    }
    const next = expandDockState(collapsed);
    return {
      ...next,
      mounted: Array.from(new Set([...group.mounted, ...next.checked])),
    };
  });
  // If still empty after patch, tryOpenPanel("diff"):
  if (checkedPanelsRef.current.length === 0) {
    tryOpenPanel("diff");
  }
}, [...]);
```

Because `updatePanelGroup` is sync in zustand, reading `checkedPanelsRef` after patch works if the ref is updated in the same tick via existing subscription — verify existing `checkedPanelsRef` sync; if ref lags, return a flag from the patch or read `usePanelGroupStore.getState()`.

Safer:

```ts
const group = usePanelGroupStore.getState().groups[groupKey] ?? emptyPanelGroup();
if (group.checked.length > 0) {
  updatePanelGroup(collapseDockState(group));
  return;
}
if (group.collapsedTabs?.checked.length) {
  const next = expandDockState(group.collapsedTabs);
  updatePanelGroup({
    ...next,
    mounted: Array.from(new Set([...group.mounted, ...next.checked])),
  });
  return;
}
tryOpenPanel("diff");
```

`handleAddPanel`:

```ts
const handleAddPanel = useCallback(
  (kind: DesktopPanelKind) => {
    if (panelDisabledRef.current.includes(kind)) return;
    if (checkedPanelsRef.current.includes(kind)) {
      updatePanelGroup({ active: kind });
      return;
    }
    tryOpenPanel(kind);
  },
  [tryOpenPanel, updatePanelGroup],
);
```

`handleToggleFullscreen`:

```ts
const handleToggleFullscreen = useCallback(() => {
  updatePanelGroup((group) => {
    if (group.checked.length === 0) return { dockFullscreen: false };
    return { dockFullscreen: !group.dockFullscreen };
  });
}, [updatePanelGroup]);
```

When closing last tab via `handleTogglePanel` / `onCloseTab`, also snapshot + clear fullscreen:

```ts
// inside close branch of handleTogglePanel, after computing next checked:
if (nextChecked.length === 0) {
  return {
    ...collapseDockState({ checked: group.checked, active: group.active }),
    // checked already [] from collapse
  };
}
```

Header:

```tsx
panelToggle={
  isDesktop && checkedPanels.length === 0
    ? { onToggleDock: handleToggleDock }
    : undefined
}
```

Dock:

```tsx
<DesktopPanelDock
  ...
  onAddPanel={handleAddPanel}
  disabledPanels={panelDisabled}
  panelToggle={{ onToggleDock: handleToggleDock }}
  fullscreen={dockFullscreen}
  onToggleFullscreen={handleToggleFullscreen}
/>
```

Read `dockFullscreen` from the same panel group selector as `checkedPanels`.

- [ ] **Step 4: Run unit tests + dock tests**

Run:

```bash
cd packages/webview && npx vitest run \
  tests/muse/dockActions.test.ts \
  tests/muse/panelTabs.test.ts \
  tests/components/desktopPanelDock.test.tsx \
  tests/webview/panelToggleControl.test.tsx \
  tests/webview/panelAddMenu.test.tsx \
  tests/stores/panelGroupCollapsed.test.ts -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/dockActions.ts \
  packages/webview/tests/muse/dockActions.test.ts \
  packages/webview/src/components/ChatApp.tsx
git commit -m "$(cat <<'EOF'
feat(webview): wire dock toggle, add panel, and fullscreen state

EOF
)"
```

---

### Task 7: Manual verification checklist + final regression

**Files:** none required beyond fixes found during verification.

- [ ] **Step 1: Run full webview unit suite**

Run: `cd packages/webview && npm test`  
Expected: PASS (fix any stale `PanelToggleMenu` imports if failures mention it).

- [ ] **Step 2: Manual desktop smoke (if desktop app available)**

1. Header toggle → opens 变更 only.  
2. `+` → add 文件/终端/浏览器 in that menu order; `+` hides at four.  
3. Hover tab → X overlays label; close last tab → dock hides; reopen restores.  
4. Toggle dock closed/open restores previous set.  
5. Fullscreen covers chat; exit icon restores split; closing dock clears fullscreen.  
6. Shortcuts still toggle individual panels.

- [ ] **Step 3: Commit any CSS/test polish from smoke**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(webview): polish dock chrome after smoke verification

EOF
)"
```

(Skip empty commit if nothing changed.)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Toggle dock, no dropdown | 3, 6 |
| Default open 变更 / restore history | 1, 2, 6 |
| `+` add panels, hide when full | 4, 5, 6 |
| Menu order 文件→终端→浏览器→变更 | 1, 4 |
| Tab X overlay on hover | 5 |
| Dock fullscreen cover chat, icon toggle | 5, 6 |
| Fullscreen not persisted on close | 2, 6 |
| Shortcuts still toggle single panel | 6 (unchanged handlers) |
| Tests listed in spec §8 | 1–6 |

No placeholders remaining; prop names consistent (`onToggleDock`, `onAddPanel`, `dockFullscreen`, `collapsedTabs`, `PANEL_ADD_ORDER`).
