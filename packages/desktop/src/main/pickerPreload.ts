import { ipcRenderer } from "electron";

/**
 * Element-picker preload for the sandboxed preview <webview> (PreviewPane).
 *
 * Runs inside the guest page with `webpreferences="sandbox=yes,
 * contextIsolation=yes"`, so it can only use the sandboxed electron polyfill
 * (ipcRenderer) plus the DOM — no other Node APIs. Protocol on channel
 * "wave-picker" (see PreviewPane.tsx):
 *
 *   host → guest : { action: "activate", palette? } | { action: "deactivate" }
 *   guest → host : { type: "ready" }  (preload finished mounting)
 *                | { type: "submit", ...PreviewComment }
 *
 * Guest → host messages go through ipcRenderer.sendToHost (plain send() from a
 * sandboxed preload routes to the main process and never reaches the <webview>
 * element's ipc-message event). The interaction logic lives in
 * createPickerController over a minimal DOM adapter (PickerHost); the adapter
 * is the only code that touches the real document, which keeps the controller
 * testable in the desktop (node) test env.
 */

export const PICKER_CHANNEL = "wave-picker";

export interface PickerPalette {
  accent: string;
  accentForeground: string;
  foreground: string;
  background: string;
  border: string;
  inputBackground: string;
  inputForeground: string;
}

export type PickerPayload =
  | { action: "activate"; palette?: PickerPalette }
  | { action: "deactivate" };

export interface PreviewComment {
  type: "submit";
  url: string;
  selector: string;
  summary: string;
  text: string;
  comment: string;
}

/** Escape a CSS id for use inside a selector (id chars that would break it). */
export function escapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** Index of `el` among same-tag siblings, 1-based (for :nth-of-type). */
export function indexAmongSiblings(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  const tag = el.tagName;
  let n = 1;
  for (const sib of Array.from(parent.children)) {
    if (sib === el) return n;
    if (sib.tagName === tag) n += 1;
  }
  return n;
}

/**
 * Minimal unique-ish CSS path to `el`: prefers the nearest id, otherwise
 * climbs tag-by-tag with :nth-of-type disambiguation, capped at 8 segments.
 */
export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== "html" && parts.length < 8) {
    const id = node.id;
    if (id) {
      parts.unshift(`#${escapeId(id)}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    const sameTag = parent
      ? Array.from(parent.children).filter((s) => s.tagName === node!.tagName)
      : [];
    parts.unshift(
      sameTag.length > 1 ? `${tag}:nth-of-type(${indexAmongSiblings(node)})` : tag,
    );
    node = parent;
  }
  return parts.join(" > ");
}

/** Short human-readable element label, e.g. `button#mock-pay-btn`. */
export function buildSummary(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${escapeId(el.id)}` : "";
  const classes = ((el.className as string | { baseVal?: string })?.toString() ??
    "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${classes}` || tag;
}

/** Element text, whitespace-collapsed and truncated for the card header. */
export function extractText(el: Element): string {
  return (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
}

export const CARD_WIDTH = 280;

/** Position the comment card below the picked element, clamped to the viewport. */
export function anchorCard(
  anchor: { left: number; bottom: number },
  viewportWidth: number,
): { left: number; top: number } {
  const left = Math.min(anchor.left, viewportWidth - CARD_WIDTH - 14);
  return { left: Math.max(8, left), top: anchor.bottom + 8 };
}

export interface PickerEventLike {
  target: EventTarget | null;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface Rect {
  left: number;
  bottom: number;
}

/** DOM surface the controller needs; implemented by createPickerHost. */
export interface PickerHost {
  href: string;
  /** Current guest viewport width, used to clamp the card position. */
  viewportWidth: number;
  /** Capture listener on the document root; returns an unsubscribe fn. */
  onDoc(
    type: "mouseover" | "click" | "keydown",
    handler: (e: PickerEventLike) => void,
  ): () => void;
  /** Page-level scroll (window), used to dismiss the card on scroll. */
  onScroll(handler: () => void): () => void;
  /** Highlight an element (null clears); ignores the comment card itself. */
  setHighlight(el: Element | null): void;
  /** True when the target belongs to the comment card (let its UI handle it). */
  isCardTarget(el: Element | null): boolean;
  /** Show the comment card anchored near the picked element. */
  showCard(opts: {
    anchor: Rect;
    viewportWidth: number;
    summary: string;
    selector: string;
    palette?: PickerPalette;
    onSubmit(comment: string): void;
    onCancel(): void;
  }): void;
  hideCard(): void;
  enableMode(): void;
  disableMode(): void;
  send(payload: PreviewComment): void;
}

/**
 * Pure interaction logic. `activate` wires the document listeners and enables
 * crosshair mode; hovering highlights, clicking pins an element and opens the
 * comment card, submitting sends a PreviewComment. The picker stays active
 * after a submit so several comments can be batched (PreviewPane semantics).
 */
export function createPickerController(host: PickerHost) {
  let active = false;
  let palette: PickerPalette | undefined;
  let cardOpen = false;
  const unsubscribers: Array<() => void> = [];
  let highlighted: Element | null = null;

  const clearHighlight = () => {
    host.setHighlight(null);
    highlighted = null;
  };

  const dismissCard = () => {
    if (!cardOpen) return;
    cardOpen = false;
    host.hideCard();
    clearHighlight();
  };

  const onMouseOver = (e: PickerEventLike) => {
    if (cardOpen) return;
    const target = e.target as Element | null;
    if (!target || host.isCardTarget(target)) return;
    const tag = target.tagName?.toLowerCase();
    if (tag === "html" || tag === "body") {
      if (highlighted) clearHighlight();
      return;
    }
    host.setHighlight(target);
    highlighted = target;
  };

  const onClick = (e: PickerEventLike) => {
    const target = e.target as Element | null;
    if (!target || host.isCardTarget(target)) return;
    const tag = target.tagName?.toLowerCase();
    if (tag === "html" || tag === "body") return;
    e.preventDefault();
    e.stopPropagation();
    if (cardOpen) dismissCard();
    const rect = target.getBoundingClientRect();
    const summary = buildSummary(target);
    const selector = buildSelector(target);
    const text = extractText(target);
    host.setHighlight(target);
    highlighted = target;
    cardOpen = true;
    host.showCard({
      anchor: { left: rect.left, bottom: rect.bottom },
      viewportWidth: host.viewportWidth,
      summary,
      selector,
      palette,
      onSubmit: (comment) => {
        const trimmed = comment.trim();
        if (!trimmed) return;
        cardOpen = false;
        host.hideCard();
        clearHighlight();
        host.send({
          type: "submit",
          url: host.href,
          selector,
          summary,
          text,
          comment: trimmed,
        });
      },
      onCancel: dismissCard,
    });
  };

  const onKeyDown = (e: PickerEventLike) => {
    if (e.key === "Escape" && cardOpen) dismissCard();
  };

  return {
    activate(nextPalette?: PickerPalette) {
      if (active) return;
      active = true;
      palette = nextPalette;
      host.enableMode();
      unsubscribers.push(host.onDoc("mouseover", onMouseOver));
      unsubscribers.push(host.onDoc("click", onClick));
      unsubscribers.push(host.onDoc("keydown", onKeyDown));
      unsubscribers.push(host.onScroll(() => dismissCard()));
    },
    deactivate() {
      if (!active) return;
      active = false;
      dismissCard();
      while (unsubscribers.length) unsubscribers.pop()?.();
      host.disableMode();
    },
    get active() {
      return active;
    },
  };
}

export interface DomPickerDeps {
  document: Document;
  href: string;
  send: (payload: PreviewComment) => void;
}

/**
 * Real-DOM adapter backing the controller inside the guest preload.
 * All styling uses inline styles + a scoped stylesheet, so it survives
 * sandbox restrictions and never depends on the page's own CSS.
 */
export function createPickerHost(deps: DomPickerDeps): PickerHost {
  const doc = deps.document;
  let highlightEl: Element | null = null;
  let cardEl: HTMLElement | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let accent = "#c1292e";

  const onDoc: PickerHost["onDoc"] = (type, handler) => {
    const wrapped = (e: Event) => {
      handler({
        target: e.target,
        key: (e as KeyboardEvent).key,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      });
    };
    doc.addEventListener(type, wrapped, true);
    return () => doc.removeEventListener(type, wrapped, true);
  };

  const onScroll: PickerHost["onScroll"] = (handler) => {
    const wrapped = () => handler();
    doc.defaultView?.addEventListener("scroll", wrapped, true);
    return () => doc.defaultView?.removeEventListener("scroll", wrapped, true);
  };

  const isCardTarget: PickerHost["isCardTarget"] = (el) => {
    return Boolean(el && cardEl && (el === cardEl || cardEl.contains(el)));
  };

  const setHighlight: PickerHost["setHighlight"] = (el) => {
    if (highlightEl && highlightEl !== el) {
      const s = highlightEl as HTMLElement;
      s.style.outline = "";
      s.style.outlineOffset = "";
    }
    highlightEl = el;
    if (el) {
      const s = el as HTMLElement;
      s.style.outline = `2px solid ${accent}`;
      s.style.outlineOffset = "-2px";
    }
  };

  const showCard: PickerHost["showCard"] = (opts) => {
    hideCard();
    if (opts.palette) accent = opts.palette.accent;
    const card = doc.createElement("div");
    cardEl = card;
    const palette = opts.palette;
    // The host-sampled palette (readPalette in PreviewPane) already carries
    // concrete Muse theme colors — inline them directly, the guest page has no
    // theme variables of its own.
    card.style.position = "fixed";
    card.style.width = `${CARD_WIDTH}px`;
    card.style.background = palette?.background ?? "#1e1e1e";
    card.style.color = palette?.foreground ?? "#cccccc";
    card.style.border =
      `1px solid ${palette?.border ?? "rgba(128, 128, 128, 0.35)"}`;
    card.style.borderRadius = "6px";
    card.style.padding = "6px";
    card.style.fontSize = "12px";
    card.style.lineHeight = "1.4";
    card.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.4)";
    card.style.zIndex = "2147483647";
    card.style.boxSizing = "border-box";

    const body = doc.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "2px";
    body.style.background = palette?.inputBackground ?? "#3c3c3c";
    body.style.color = palette?.inputForeground ?? "#cccccc";
    body.style.border = `1px solid ${accent}`;
    body.style.borderRadius = "6px";
    body.style.padding = "6px";

    const textarea = doc.createElement("textarea");
    textarea.placeholder = "输入评论，回车或点「添加」提交";
    textarea.rows = 2;
    textarea.style.cssText = [
      "width:100%",
      "min-height:40px",
      "background:transparent",
      "border:none",
      "color:inherit",
      "font:inherit",
      "font-size:12px",
      "line-height:1.4",
      "resize:vertical",
      "outline:none",
      "padding:0",
    ].join(";");

    const footer = doc.createElement("div");
    footer.style.display = "flex";
    footer.style.alignItems = "center";
    footer.style.gap = "6px";

    const tag = doc.createElement("div");
    tag.textContent = opts.summary;
    tag.title = opts.selector;
    tag.style.cssText = [
      "flex:1",
      `color:${accent}`,
      "font-family:monospace",
      "font-size:11px",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "white-space:nowrap",
    ].join(";");

    const add = doc.createElement("button");
    add.textContent = "添加";
    add.style.cssText = [
      "background:transparent",
      `color:${accent}`,
      `border:1px solid ${palette?.border ?? "rgba(128,128,128,0.35)"}`,
      "border-radius:3px",
      "font-size:11px",
      "padding:2px 10px",
      "cursor:pointer",
    ].join(";");

    footer.appendChild(tag);
    footer.appendChild(add);
    body.appendChild(textarea);
    body.appendChild(footer);
    card.appendChild(body);

    const { left, top } = anchorCard(opts.anchor, opts.viewportWidth);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    add.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onSubmit(textarea.value);
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        opts.onSubmit(textarea.value);
      }
    });

    doc.body.appendChild(card);
    textarea.focus();
  };

  const hideCard = () => {
    cardEl?.remove();
    cardEl = null;
  };

  const enableMode = () => {
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.textContent = [
        ".wave-picker-mode,",
        ".wave-picker-mode *",
        "{ cursor: crosshair !important; }",
      ].join("");
      doc.head?.appendChild(styleEl);
    }
    doc.documentElement.classList.add("wave-picker-mode");
  };

  const disableMode = () => {
    doc.documentElement.classList.remove("wave-picker-mode");
    styleEl?.remove();
    styleEl = null;
    hideCard();
    setHighlight(null);
  };

  return {
    href: deps.href,
    viewportWidth: doc.documentElement.clientWidth,
    onDoc,
    onScroll,
    setHighlight,
    isCardTarget,
    showCard,
    hideCard,
    enableMode,
    disableMode,
    send: deps.send,
  };
}

// ── Entry: wire the sandboxed guest. Top-level only uses ipcRenderer, so it
// never touches the DOM here — the controller is created lazily on activate. ─
//
// Messages from a sandboxed guest preload must use ipcRenderer.sendToHost:
// plain send() goes to the main process, which never surfaces as the <webview>
// element's `ipc-message` event that PreviewPane listens for (verified in
// Electron 43 via an isolated smoke test). The host → guest direction (wv.send)
// is received below with ipcRenderer.on.
let controller: ReturnType<typeof createPickerController> | null = null;

ipcRenderer.on(PICKER_CHANNEL, (_event, msg: PickerPayload) => {
  if (msg?.action === "activate") {
    if (!controller) {
      controller = createPickerController(
        createPickerHost({
          document,
          href: window.location.href,
          send: (payload) => ipcRenderer.sendToHost(PICKER_CHANNEL, payload),
        }),
      );
    }
    controller.activate(msg.palette);
  } else if (msg?.action === "deactivate") {
    controller?.deactivate();
  }
});

// Announce readiness so PreviewPane can enable the toggle. Every document load
// (navigation, refresh) re-runs this preload and re-announces.
ipcRenderer.sendToHost(PICKER_CHANNEL, { type: "ready" });
