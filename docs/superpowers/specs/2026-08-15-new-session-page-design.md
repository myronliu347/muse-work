# New Session Page (Desktop Draft) Design

**Date:** 2026-08-15  
**Status:** Approved for planning  
**Scope:** Desktop host only; draft / `__draft__` new conversations

## Problem

Today the empty new-session state reuses the normal chat column: a centered `WelcomeView` above a **bottom-pinned** `MessageInput`. That reads as an empty chat, not a dedicated start page. Users want a distinct new-session page with the composer centered.

Clearing a bound session must **not** enter this page (folder picker / new-session chrome stay draft-only — already gated by `isDraftSession`).

## Goals

1. On desktop draft sessions, replace the chat column with a standalone **New Session** page.
2. Vertically and horizontally center a single column: welcome + chat input.
3. Do **not** show ChatHeader or the panel dock on this page.
4. When the session becomes bound (first message / host assigns a real session id), return to the normal chat column (header + messages + bottom input + panels available).

## Non-Goals

- VS Code / JetBrains webview layout changes.
- Using this page after `/clear` on a bound session.
- New input behavior, workdir rules, or panel feature work beyond hiding the dock on draft.
- Large motion / marketing redesign beyond centering the existing welcome + input.

## Approach

**Independent `NewSessionPage` component** (not CSS-only layout flip on the existing chat body).

- Mounted when `host.type === "desktop" && isDraftSession`.
- Reuses `WelcomeView` (or its content) and the same `MessageInput` wiring ChatApp already builds for draft (workdir selector, permission mode, model, send).
- Sidebar stays; only `desktop-chat-main` (and its adjacent panel dock) is replaced / omitted.

## Layout

```
┌──────────┬─────────────────────────────────────┐
│ Sidebar  │         NewSessionPage              │
│          │    ┌─────────────────────────┐      │
│  新对话   │    │  Logo + welcome copy    │      │
│  sessions│    │  MessageInput (centered)│      │
│          │    └─────────────────────────┘      │
│          │         (no header, no dock)        │
└──────────┴─────────────────────────────────────┘
```

- Content column ~640–720px max-width, horizontally centered.
- Page fills the chat main area; inner stack is vertically centered.
- No ChatHeader; no `DesktopPanelDock` / panel slots.

## Component & Data Flow

| Piece | Responsibility |
|---|---|
| `NewSessionPage` | Shell + CSS; compose welcome + `children` or `input` slot |
| `WelcomeView` | Existing copy / login CTA; may drop outer flex if the page owns centering |
| `MessageInput` | Unchanged behavior; draft workdir / worktree controls as today |
| `ChatApp` / `DesktopApp` | Gate: draft → `NewSessionPage`; else existing `chatChrome` + dock |

Input state continues to live in the chat reducer / `MessageInput` as today. No separate cross-page cache: when the tree switches to the bound chat column, existing `sessionId` / `inputContent` / refs follow current patterns.

## Panel dock

- Draft: **do not render** the panel dock (not merely disable toggles).
- Bound: restore current dock + panel toggle behavior.

## Edge Cases

| Case | Behavior |
|---|---|
| Draft, not initialized | Keep current loading affordance until auth/initial state ready (welcome flash rules unchanged in spirit) |
| Draft + login required | Welcome login CTA still shown above input |
| Split panes: one draft, one bound | Each pane decides independently; only draft panes use `NewSessionPage` / no dock |
| First send binds session | Switch to normal chat column; message list + bottom input |

## Testing

- Draft desktop: `NewSessionPage` (or equivalent testid) visible; `desktop-panel-dock` absent; composer present and centered under welcome.
- After `setInitialState` with a real session id: page gone; normal chat container + dock path available again.
- Cleared bound session (empty messages, real id): still **not** `NewSessionPage`; no workdir folder picker (existing draft-only rule).

## Files (expected)

- `packages/webview/src/components/chat/NewSessionPage.tsx` (+ CSS)
- `packages/webview/src/components/ChatApp.tsx` (and/or `DesktopApp.tsx`) — branch render, omit dock on draft
- Tests under `packages/webview/tests/components/` (and adjust desktop draft fixtures as needed)
