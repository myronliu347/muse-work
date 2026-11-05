import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";

const userMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

/**
 * jsdom does not do layout, so offsetTop/scrollTop/clientHeight are all 0.
 * Fake the geometry: assign an increasing offsetTop to each user message node,
 * set the container scrollTop past the first message, then dispatch a scroll event.
 */
function fakeGeometryAndScroll(scrollTop: number) {
  const container = screen.getByTestId("messages-container");
  Object.defineProperty(container, "scrollTop", {
    value: scrollTop,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 400,
    configurable: true,
  });
  Object.defineProperty(container, "scrollHeight", {
    value: 2000,
    configurable: true,
  });
  const nodes = container.querySelectorAll<HTMLElement>(
    '[data-role="user"][data-message-id]',
  );
  const containerTop = 80;
  Object.defineProperty(container, "getBoundingClientRect", {
    value: () => ({
      top: containerTop,
      left: 0,
      right: 800,
      bottom: containerTop + 400,
      width: 800,
      height: 400,
    }),
    configurable: true,
  });
  nodes.forEach((node, i) => {
    const offsetTop = i * 500;
    Object.defineProperty(node, "offsetTop", {
      value: offsetTop,
      configurable: true,
    });
    const topInView = containerTop + offsetTop - scrollTop;
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => ({
        top: topInView,
        left: 0,
        right: 800,
        bottom: topInView + 48,
        width: 800,
        height: 48,
      }),
      configurable: true,
    });
  });
  act(() => {
    fireEvent.scroll(container);
  });
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

describe("sticky user message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Row offsets come from the virtualizer's measurements, which read offsetHeight.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    }
  });

  it("has no sticky header before scrolling", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("第一条问题", "u1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("sticky-user-message")).not.toBeInTheDocument();
  });

  it("pins the most recent user message scrolled above the viewport top", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          userMsg("第三条问题", "u3"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // scrollTop 1200 → u1(0) and u2(500) and u3(1000) are all above; last one is u3
    fakeGeometryAndScroll(1200);

    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
      "第三条问题",
    );
  });

  it("pins a system-inject message with the same system card as the list", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("<system-inject>请执行清单项</system-inject>", "u1"),
          userMsg("后面的问题", "u2"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    fakeGeometryAndScroll(100);

    const sticky = await screen.findByTestId("sticky-user-message");
    expect(sticky.querySelector(".system-inject-bubble")).toBeTruthy();
    expect(sticky.querySelector(".system-inject-head")?.textContent).toContain("系统");
    expect(sticky.textContent).toContain("请执行清单项");
    expect(sticky.textContent).not.toContain("<system-inject>");
    expect(sticky.className).toContain("sticky-user-message--system");
  });

  it("switches the pinned message as scroll position changes", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          userMsg("第三条问题", "u3"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // scrollTop 600 → only u1(0) is above u2(500)? u2 offsetTop 500 < 600 too → last above is u2
    fakeGeometryAndScroll(600);
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第二条问题",
      );
    });
  });

  it("does not pin the previous message over the one just jumped to", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          userMsg("第三条问题", "u3"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-message-nav-u2")).toBeInTheDocument(),
    );

    const container = screen.getByTestId("messages-container");
    // jsdom reports a 0 scroll range, which clamps every jump to the top.
    Object.defineProperty(container, "scrollHeight", {
      value: 4000,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(container, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = function scrollTo() {};
    }
    const spy = vi.spyOn(container, "scrollTo").mockImplementation(() => {});
    act(() => {
      fireEvent.click(screen.getByTestId("user-message-nav-u2"));
    });
    const jumped = spy.mock.calls
      .map((call) => {
        const arg = call[0] as { top?: number } | undefined;
        return arg?.top;
      })
      .filter((top): top is number => typeof top === "number")
      .at(-1);
    expect(jumped).toBeGreaterThan(0);

    Object.defineProperty(container, "scrollTop", {
      value: jumped,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 400,
      configurable: true,
    });
    act(() => {
      fireEvent.scroll(container);
    });
    expect(screen.queryByTestId("sticky-user-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-message-nav-u2").className).toContain(
      "user-message-nav-item--active",
    );
  });

  it("clicking the sticky header scrolls the original message to the viewport center", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("第一条问题", "u1"), userMsg("第二条问题", "u2")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    fakeGeometryAndScroll(700);
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument(),
    );

    const container = screen.getByTestId("messages-container");
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = function scrollTo() {};
    }
    const spy = vi.spyOn(container, "scrollTo").mockImplementation(() => {});
    act(() => {
      fireEvent.click(screen.getByTestId("sticky-user-message"));
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
  });

  it("renders sticky content with the 3-line clamp class", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("第一条问题", "u1"), userMsg("第二条问题", "u2")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    fakeGeometryAndScroll(700);
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument(),
    );
    expect(document.querySelector(".sticky-user-content")).toBeInTheDocument();
  });
});
