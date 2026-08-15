# New Session Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop draft sessions, replace the chat column with a centered `NewSessionPage` (welcome + composer) and omit the panel dock until the session is bound.

**Architecture:** Add a presentational `NewSessionPage` shell. `ChatApp` already knows `isDraftSession`; when `isDesktop && isDraftSession`, render that page inside `desktop-chat-main` with the existing draft `MessageInput` tree as a slot, and skip `DesktopPanelDock`. Bound sessions keep today’s header + message list + bottom input + dock.

**Tech Stack:** React 18, existing webview CSS tokens (`--gray-*`, `--space-*`), Vitest + Testing Library, `DesktopApp` test harness via `createMockVscode` / `sendCommand`

**Spec:** `docs/superpowers/specs/2026-08-15-new-session-page-design.md`

## Global Constraints

- Desktop only: `host.type === "desktop"`; VSCE/JB keep current chat column
- Gate: `isDraftSession` (`!currentSession?.id || id === "__draft__"`) — never after `/clear` on a bound session
- No ChatHeader and no panel dock on the new-session page
- Content column max-width 640–720px; page vertically + horizontally centers welcome + input
- Reuse `WelcomeView` + existing `MessageInput` wiring; no new input/workdir semantics
- Tests: prefer `packages/webview/tests/components/**` (included by vitest); use `/** @vitest-environment jsdom */`
- Brand / copy: keep existing WelcomeView Chinese strings

## File Structure

```text
packages/webview/src/components/chat/NewSessionPage.tsx   # shell + slots
packages/webview/src/styles/NewSessionPage.css            # centered column
packages/webview/src/components/chat/WelcomeView.tsx      # optional: embedded layout (no full-height outer flex)
packages/webview/src/components/ChatApp.tsx               # draft branch; omit dock
packages/webview/tests/components/newSessionPage.test.tsx # unit shell
packages/webview/tests/components/workdirSelector.draft.test.tsx  # extend / sibling draft UX assertions
```

---

### Task 1: `NewSessionPage` shell (TDD)

**Files:**
- Create: `packages/webview/src/components/chat/NewSessionPage.tsx`
- Create: `packages/webview/src/styles/NewSessionPage.css`
- Test: `packages/webview/tests/components/newSessionPage.test.tsx`

**Interfaces:**
- Consumes: `welcome: React.ReactNode`, `composer: React.ReactNode`
- Produces: `NewSessionPage` with `data-testid="new-session-page"`

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewSessionPage } from "../../src/components/chat/NewSessionPage";

describe("NewSessionPage", () => {
  it("renders welcome above composer inside a dedicated page shell", () => {
    render(
      <NewSessionPage
        welcome={<div data-testid="welcome-slot">欢迎</div>}
        composer={<div data-testid="composer-slot">输入框</div>}
      />,
    );
    const page = screen.getByTestId("new-session-page");
    expect(page).toBeInTheDocument();
    expect(screen.getByTestId("welcome-slot")).toBeInTheDocument();
    expect(screen.getByTestId("composer-slot")).toBeInTheDocument();
    // welcome precedes composer in DOM order
    const html = page.innerHTML;
    expect(html.indexOf("welcome-slot")).toBeLessThan(
      html.indexOf("composer-slot"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/webview && npx vitest run tests/components/newSessionPage.test.tsx`

Expected: FAIL (module / component not found)

- [ ] **Step 3: Write minimal implementation**

`NewSessionPage.tsx`:

```tsx
import React from "react";
import "../../styles/NewSessionPage.css";

export interface NewSessionPageProps {
  welcome: React.ReactNode;
  composer: React.ReactNode;
}

export const NewSessionPage: React.FC<NewSessionPageProps> = ({
  welcome,
  composer,
}) => (
  <div className="new-session-page" data-testid="new-session-page">
    <div className="new-session-page-column">
      <div className="new-session-page-welcome">{welcome}</div>
      <div className="new-session-page-composer">{composer}</div>
    </div>
  </div>
);

export default NewSessionPage;
```

`NewSessionPage.css`:

```css
.new-session-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: var(--space-5) var(--space-4);
}

.new-session-page-column {
  width: 100%;
  max-width: 680px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-5);
}

.new-session-page-welcome {
  display: flex;
  justify-content: center;
}

.new-session-page-composer {
  width: 100%;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/webview && npx vitest run tests/components/newSessionPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/chat/NewSessionPage.tsx \
  packages/webview/src/styles/NewSessionPage.css \
  packages/webview/tests/components/newSessionPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): add NewSessionPage shell for centered draft composer

EOF
)"
```

---

### Task 2: Wire draft desktop ChatApp to `NewSessionPage` + hide dock

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx` (draft branch around `chatContainer` / `chatBodyContent` / `MessageInput`)
- Modify: `packages/webview/src/components/chat/WelcomeView.tsx` only if the outer full-height flex double-centers or stretches oddly inside the page (prefer a small `embedded` prop or strip outer `flex:1` wrapper when used as a slot)
- Test: `packages/webview/tests/components/newSessionPage.desktop.test.tsx` (or extend `workdirSelector.draft.test.tsx`)

**Interfaces:**
- Consumes: `NewSessionPage`, existing `WelcomeView` props, existing draft `MessageInput` JSX
- Produces: When `isDesktop && isDraftSession`, `desktop-chat-main` shows `new-session-page` and `desktop-panel-dock` is absent

- [ ] **Step 1: Write the failing integration tests**

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "../webview/test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktopApp() {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  return { vscode };
}

describe("Desktop draft NewSessionPage", () => {
  it("shows NewSessionPage without panel dock on draft", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });

    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();
    expect(screen.getByTestId("message-input")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-muse-logo")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-panel-dock")).not.toBeInTheDocument();
    // No chat header chrome on draft page
    expect(screen.queryByTestId("new-session-btn")).not.toBeInTheDocument();
  });

  it("leaves NewSessionPage after the session is bound", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();

    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      isAuthenticated: true,
      session: {
        id: "sess-1",
        sessionType: "main",
        workdir: "/home/user/project",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    expect(screen.queryByTestId("new-session-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });

  it("does not show NewSessionPage after clearing a bound session", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      isAuthenticated: true,
      session: {
        id: "sess-1",
        sessionType: "main",
        workdir: "/home/user/project",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });
    sendCommand("updateMessages", { messages: [] });

    expect(screen.queryByTestId("new-session-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-workdir")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/webview && npx vitest run tests/components/newSessionPage.desktop.test.tsx`

Expected: FAIL — `new-session-page` not found on draft

- [ ] **Step 3: Extract composer + branch render in ChatApp**

In `ChatApp.tsx`:

1. Import `NewSessionPage`.
2. Keep a single `messageInput` element (the existing `<MessageInput ... />` block including draft `workdirSelector`). Do not duplicate props.
3. Split body so draft desktop does not use bottom-pinned `input-area-container` for the page:

Pseudo-structure (adapt to current variables; keep restore overlay / confirmations working on bound path only as today):

```tsx
const showNewSessionPage = isDesktop && isDraftSession && state.initialized;

const messageInput = (
  <MessageInput
    ref={messageInputRef}
    /* ...existing props; draft workdirSelector unchanged... */
  />
);

// Bound / non-desktop chat body stays as today, but MessageInput uses `messageInput`
// instead of inlining a second copy.

const newSessionPage = (
  <NewSessionPage
    welcome={
      <WelcomeView
        isAuthenticated={state.isAuthenticated}
        hasDirectConnectConfig={/* existing */}
        onLogin={handleLogin}
      />
    }
    composer={messageInput}
  />
);
```

In `chatContainer` desktop branch:

```tsx
<div className="desktop-chat-body">
  <div className="desktop-chat-main">
    {showNewSessionPage ? newSessionPage : chatChrome}
  </div>
  {!isDraftSession && checkedPanels.length > 0 && activePanel && (
    <DesktopPanelDock /* ...existing props... */>
      {/* ...existing slots... */}
    </DesktopPanelDock>
  )}
</div>
```

Important details:

- While `isDraftSession && !state.initialized`, keep a loading affordance (existing `LoadingLogo` path) — either inside `desktop-chat-main` or by not flipping to `NewSessionPage` until `state.initialized` (matches `showWelcomeReady` spirit).
- Do **not** render `ChatHeader` inside `NewSessionPage`.
- When `showNewSessionPage`, do not also render the old `WelcomeView` + bottom `input-area-container` (avoid double composer).
- If `WelcomeView`’s outer `flex:1; height:100%` fights the page layout, add an optional prop e.g. `layout="embedded"` that removes the full-height outer wrapper and keeps only the inner 400px content stack.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd packages/webview && npx vitest run \
  tests/components/newSessionPage.test.tsx \
  tests/components/newSessionPage.desktop.test.tsx \
  tests/components/workdirSelector.draft.test.tsx
```

Expected: all PASS

Also smoke any included desktop tests that assert draft workdir UI still works (`desktop-workdir` on draft).

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx \
  packages/webview/src/components/chat/WelcomeView.tsx \
  packages/webview/tests/components/newSessionPage.desktop.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): use NewSessionPage for desktop draft chats without panel dock

EOF
)"
```

---

### Task 3: Polish + regression pass

**Files:**
- Modify: `packages/webview/src/styles/NewSessionPage.css` / `WelcomeView` as needed after visual check
- Modify: any stale assertions in `tests/webview/desktopApp.test.tsx` only if that file is brought into vitest include; otherwise leave orphaned until separately enabled
- Test: re-run component suite above

**Interfaces:**
- Consumes: Tasks 1–2 behavior
- Produces: no behavior change beyond spacing/alignment polish

- [ ] **Step 1: Manual checklist (desktop)**

1. Click 新对话 → centered welcome + input; no header; no panel dock.
2. Select workdir / send first message → normal chat column; panels can open again.
3. `/clear` on bound session → empty chat / welcome-in-column as today, **not** `NewSessionPage`; no folder picker.
4. Split: draft pane has page; bound pane has dock path independently.

- [ ] **Step 2: Fix any spacing issues**

If the input looks too wide/narrow, keep `max-width: 680px` on `.new-session-page-column` (spec range 640–720). Ensure composer width is `100%` of that column.

- [ ] **Step 3: Run focused tests again**

Run: `cd packages/webview && npx vitest run tests/components/newSessionPage*.test.tsx tests/components/workdirSelector.draft.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit** (only if polish changed files)

```bash
git add packages/webview/src/styles/NewSessionPage.css \
  packages/webview/src/components/chat/WelcomeView.tsx
git commit -m "$(cat <<'EOF'
style(webview): polish NewSessionPage vertical centering

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Desktop draft → standalone page | Task 2 |
| Center welcome + composer | Task 1 CSS + Task 2 wire |
| No ChatHeader on draft page | Task 2 |
| No panel dock on draft | Task 2 (`!isDraftSession && …Dock`) |
| Bound session → normal column | Task 2 test + branch |
| Clear bound ≠ new session page | Task 2 test |
| VSCE/JB unchanged | Gate `isDesktop` |
| Reuse WelcomeView + MessageInput | Task 2 |

No placeholders left in steps; types match `NewSessionPageProps` across tasks.
