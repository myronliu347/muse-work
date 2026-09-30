import { describe, expect, it, vi } from "vitest";

// Capture the handlers the guest preload registers + the ready announcement.
// Sandboxed guest preloads must use sendToHost — plain send() would route to
// the main process and never surface as the <webview> ipc-message event.
const { ipcOnHandlers, ipcSend, ipcSendToHost } = vi.hoisted(() => ({
  ipcOnHandlers: [] as Array<(event: unknown, msg: unknown) => void>,
  ipcSend: vi.fn(),
  ipcSendToHost: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: {
    on: (_channel: string, handler: (event: unknown, msg: unknown) => void) => {
      ipcOnHandlers.push(handler);
    },
    send: ipcSend,
    sendToHost: ipcSendToHost,
  },
}));

import {
  PICKER_CHANNEL,
  anchorCard,
  buildSelector,
  buildSummary,
  createPickerController,
  escapeId,
  extractText,
  indexAmongSiblings,
  type PickerHost,
} from "../src/main/pickerPreload.js";

/** Minimal Element stand-in shaped enough for the pure helpers + controller. */
function fakeEl(opts: {
  tagName?: string;
  id?: string;
  className?: string;
  textContent?: string;
  parent?: Element;
  children?: Element[];
  rect?: { left: number; bottom: number };
}): Element {
  const el: Record<string, unknown> = {
    tagName: opts.tagName ?? "DIV",
    id: opts.id ?? "",
    className: opts.className ?? "",
    textContent: opts.textContent ?? "",
    parentElement: opts.parent ?? null,
    getBoundingClientRect: () => ({
      left: opts.rect?.left ?? 10,
      bottom: opts.rect?.bottom ?? 40,
    }),
  };
  el.children = (opts.children ?? []).map((c) => {
    (c as { parentElement: Element | null }).parentElement = el as Element;
    return c;
  });
  return el as unknown as Element;
}

function fakeHost() {
  const handlers: Record<
    "mouseover" | "click" | "keydown" | "scroll",
    Array<(e: unknown) => void>
  > = { mouseover: [], click: [], keydown: [], scroll: [] };
  const unsub = vi.fn();
  const host: PickerHost = {
    href: "http://localhost:5173/orders",
    viewportWidth: 800,
    onDoc: ((type: "mouseover" | "click" | "keydown", h: (e: unknown) => void) => {
      handlers[type].push(h);
      return unsub;
    }) as PickerHost["onDoc"],
    onScroll: ((h: () => void) => {
      handlers.scroll.push(h);
      return unsub;
    }) as PickerHost["onScroll"],
    setHighlight: vi.fn(),
    isCardTarget: vi.fn(() => false),
    showCard: vi.fn(),
    hideCard: vi.fn(),
    enableMode: vi.fn(),
    disableMode: vi.fn(),
    send: vi.fn(),
  };
  return { host, handlers, unsub };
}

function eventWith(target: Element | null, key?: string) {
  return {
    target,
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe("buildSelector", () => {
  it("prefers the nearest id and stops climbing", () => {
    const root = fakeEl({ tagName: "DIV" });
    const btn = fakeEl({ tagName: "BUTTON", id: "pay-btn", parent: root });
    expect(buildSelector(btn)).toBe("#pay-btn");
  });

  it("climbs tag-by-tag without ids", () => {
    const root = fakeEl({ tagName: "DIV" });
    const btn = fakeEl({ tagName: "BUTTON", parent: root });
    expect(buildSelector(btn)).toBe("div > button");
  });

  it("disambiguates same-tag siblings with nth-of-type", () => {
    const root = fakeEl({ tagName: "DIV" });
    const first = fakeEl({ tagName: "BUTTON", parent: root });
    const second = fakeEl({ tagName: "BUTTON", parent: root });
    fakeEl({ children: [first, second] });
    expect(buildSelector(second)).toBe("div > button:nth-of-type(2)");
  });

  it("escapes id characters that would break a selector", () => {
    expect(escapeId("a.b:c")).toBe("a\\.b\\:c");
  });

  it("caps the path length", () => {
    let leaf = fakeEl({ tagName: "SPAN" });
    for (let i = 0; i < 12; i += 1) {
      leaf = fakeEl({ tagName: "DIV", children: [leaf] });
    }
    expect(buildSelector(leaf).split(" > ").length).toBeLessThanOrEqual(8);
  });
});

describe("indexAmongSiblings", () => {
  it("returns 1-based index among same-tag siblings", () => {
    const root = fakeEl({ tagName: "UL" });
    const a = fakeEl({ tagName: "LI", parent: root });
    const b = fakeEl({ tagName: "LI", parent: root });
    const span = fakeEl({ tagName: "SPAN", parent: root });
    fakeEl({ children: [a, b, span] });
    expect(indexAmongSiblings(b)).toBe(2);
  });
});

describe("buildSummary", () => {
  it("builds tag#id.class labels", () => {
    const el = fakeEl({
      tagName: "BUTTON",
      id: "mock-pay-btn",
      className: "primary big",
    });
    expect(buildSummary(el)).toBe("button#mock-pay-btn.primary.big");
  });

  it("caps classes at two and omits empty pieces", () => {
    const el = fakeEl({
      tagName: "BUTTON",
      className: "a b c d",
    });
    expect(buildSummary(el)).toBe("button.a.b");
    expect(buildSummary(fakeEl({ tagName: "SPAN" }))).toBe("span");
  });
});

describe("extractText", () => {
  it("collapses whitespace and trims", () => {
    expect(extractText(fakeEl({ textContent: "  去支付  \n 确认 " }))).toBe(
      "去支付 确认",
    );
  });

  it("truncates long text", () => {
    expect(extractText(fakeEl({ textContent: "x".repeat(100) }))).toHaveLength(60);
  });
});

describe("anchorCard", () => {
  it("places the card below the element, clamped to the viewport", () => {
    expect(anchorCard({ left: 10, bottom: 40 }, 800)).toEqual({
      left: 10,
      top: 48,
    });
    // right overflow clamps, still keeps the 8px gutter
    expect(anchorCard({ left: 700, bottom: 40 }, 800)).toEqual({
      left: 800 - 280 - 14,
      top: 48,
    });
  });
});

describe("createPickerController", () => {
  it("activates picker mode and wires document listeners", () => {
    const { host, handlers } = fakeHost();
    const controller = createPickerController(host);
    controller.activate({ accent: "#c1292e" } as never);
    expect(controller.active).toBe(true);
    expect(host.enableMode).toHaveBeenCalledTimes(1);
    expect(handlers.mouseover).toHaveLength(1);
    expect(handlers.click).toHaveLength(1);
    expect(handlers.keydown).toHaveLength(1);
    expect(handlers.scroll).toHaveLength(1);
  });

  it("highlights the hovered element and clears on html/body", () => {
    const { host, handlers } = fakeHost();
    createPickerController(host).activate();
    const btn = fakeEl({ tagName: "BUTTON" });
    handlers.mouseover.forEach((h) => h(eventWith(btn)));
    expect(host.setHighlight).toHaveBeenLastCalledWith(btn);

    handlers.mouseover.forEach((h) =>
      h(eventWith(fakeEl({ tagName: "HTML" }))),
    );
    expect(host.setHighlight).toHaveBeenLastCalledWith(null);
  });

  it("clicking an element opens the card and blocks the page click", () => {
    const { host, handlers } = fakeHost();
    createPickerController(host).activate();
    const btn = fakeEl({
      tagName: "BUTTON",
      id: "pay-btn",
      textContent: "去支付",
      rect: { left: 10, bottom: 40 },
    });
    const ev = eventWith(btn);
    handlers.click.forEach((h) => h(ev));
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(host.showCard).toHaveBeenCalledTimes(1);
    const opts = (host.showCard as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.summary).toBe("button#pay-btn");
    expect(opts.selector).toBe("#pay-btn");
    expect(opts.anchor).toEqual({ left: 10, bottom: 40 });
  });

  it("submit sends the PreviewComment and stays active for the next pick", () => {
    const { host, handlers } = fakeHost();
    const controller = createPickerController(host);
    controller.activate();
    const btn = fakeEl({
      tagName: "BUTTON",
      textContent: "去支付",
      rect: { left: 10, bottom: 40 },
    });
    handlers.click.forEach((h) => h(eventWith(btn)));
    const opts = (host.showCard as ReturnType<typeof vi.fn>).mock.calls[0][0];
    opts.onSubmit("  改成主要按钮样式  ");

    expect(host.send).toHaveBeenCalledWith({
      type: "submit",
      url: "http://localhost:5173/orders",
      selector: "button",
      summary: "button",
      text: "去支付",
      comment: "改成主要按钮样式",
    });
    expect(host.hideCard).toHaveBeenCalled();
    // picker stays active: hovering again highlights again
    const chip = fakeEl({ tagName: "SPAN" });
    handlers.mouseover.forEach((h) => h(eventWith(chip)));
    expect(host.setHighlight).toHaveBeenLastCalledWith(chip);
  });

  it("ignores empty comments", () => {
    const { host, handlers } = fakeHost();
    createPickerController(host).activate();
    const btn = fakeEl({ tagName: "BUTTON", rect: { left: 0, bottom: 0 } });
    handlers.click.forEach((h) => h(eventWith(btn)));
    const opts = (host.showCard as ReturnType<typeof vi.fn>).mock.calls[0][0];
    opts.onSubmit("   ");
    expect(host.send).not.toHaveBeenCalled();
  });

  it("Esc dismisses the card without deactivating", () => {
    const { host, handlers } = fakeHost();
    const controller = createPickerController(host);
    controller.activate();
    const btn = fakeEl({ tagName: "BUTTON", rect: { left: 0, bottom: 0 } });
    handlers.click.forEach((h) => h(eventWith(btn)));
    handlers.keydown.forEach((h) => h(eventWith(null, "Escape")));
    expect(host.hideCard).toHaveBeenCalled();
    expect(host.setHighlight).toHaveBeenLastCalledWith(null);
    expect(controller.active).toBe(true);
  });

  it("lets the comment card handle its own clicks", () => {
    const { host, handlers } = fakeHost();
    (host.isCardTarget as ReturnType<typeof vi.fn>).mockReturnValue(true);
    createPickerController(host).activate();
    const cardChild = fakeEl({ tagName: "TEXTAREA" });
    const ev = eventWith(cardChild);
    handlers.click.forEach((h) => h(ev));
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(host.showCard).not.toHaveBeenCalled();
  });

  it("deactivate tears everything down", () => {
    const { host, handlers, unsub } = fakeHost();
    const controller = createPickerController(host);
    controller.activate();
    controller.deactivate();
    expect(controller.active).toBe(false);
    expect(host.disableMode).toHaveBeenCalled();
    // 4 listeners were registered, each unsubscribe called once
    expect(unsub).toHaveBeenCalledTimes(4);
  });

  it("scrolling dismisses an open card", () => {
    const { host, handlers } = fakeHost();
    createPickerController(host).activate();
    const btn = fakeEl({ tagName: "BUTTON", rect: { left: 0, bottom: 0 } });
    handlers.click.forEach((h) => h(eventWith(btn)));
    handlers.scroll.forEach((h) => h());
    expect(host.hideCard).toHaveBeenCalled();
    expect(host.setHighlight).toHaveBeenLastCalledWith(null);
  });
});

describe("pickerPreload entry", () => {
  it("announces ready via sendToHost and registers the muse-picker channel", () => {
    expect(ipcSendToHost).toHaveBeenCalledWith(PICKER_CHANNEL, {
      type: "ready",
    });
    // Plain send() from a sandboxed guest preload would miss the host webview.
    expect(ipcSend).not.toHaveBeenCalled();
    expect(ipcOnHandlers).toHaveLength(1);
  });

  it("deactivate without prior activate is a safe no-op", () => {
    ipcOnHandlers[0]({}, { action: "deactivate" });
    // no throw; nothing else observable without a DOM
  });
});
