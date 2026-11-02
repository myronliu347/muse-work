import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  render,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";
import { ContextTag } from "../../src/components/shared/ContextTag";
import { Tooltip } from "../../src/components/shared/Tooltip";

describe("Tooltip Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show tooltip on mouseEnter and hide on mouseLeave for the send button", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
      });
    });

    const sendBtn = screen.getByTestId("send-btn");
    const container = sendBtn.closest(".tooltip-container") as HTMLElement;
    expect(container).not.toBeNull();

    // Initially no visible tooltip
    expect(document.querySelector(".tooltip-box.visible")).toBeNull();

    // Hover over the send button
    await act(async () => {
      fireEvent.mouseEnter(container);
    });

    // Tooltip should become visible
    await waitFor(() => {
      const tooltip = document.querySelector(".tooltip-box.visible");
      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveTextContent("发送");
    });

    // Mouse leave
    await act(async () => {
      fireEvent.mouseLeave(container);
    });

    // Tooltip should be hidden
    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).toBeNull();
    });
  });

  it("shows a rail label beside the icon on hover", async () => {
    renderChatApp(undefined, { surface: "assistant" });

    const labels: Array<[string, string]> = [
      ["desktop-assistant-menu", "灵光"],
      ["desktop-sessions-menu", "会话"],
      ["desktop-automations-menu", "自动化"],
      ["desktop-skills-menu", "技能"],
      ["desktop-settings-btn", "设置"],
    ];
    for (const [testId, label] of labels) {
      const button = screen.getByTestId(testId);
      expect(button).toHaveAttribute("aria-label", label);
      await act(async () => {
        fireEvent.mouseEnter(button);
      });
      const tip = document.querySelector(".tooltip-box.visible");
      expect(tip).not.toBeNull();
      expect(tip).toHaveTextContent(label);
      await act(async () => {
        fireEvent.mouseLeave(button);
      });
    }
  });

  it("should show tooltip for the abort button during streaming", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
        isStreaming: true,
      });
    });

    const abortBtn = screen.getByTestId("abort-btn");
    const container = abortBtn.closest(".tooltip-container") as HTMLElement;
    expect(container).not.toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(container);
    });

    await waitFor(() => {
      const tooltip = document.querySelector(".tooltip-box.visible");
      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveTextContent("停止");
    });
  });

  it('should have role="tooltip" on tooltip elements', async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
      });
    });

    const sendBtn = screen.getByTestId("send-btn");
    const container = sendBtn.closest(".tooltip-container") as HTMLElement;

    await act(async () => {
      fireEvent.mouseEnter(container);
    });

    await waitFor(() => {
      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip).not.toBeNull();
    });
  });

  describe("viewport overflow clamping", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    const setViewport = (width: number, height: number) => {
      Object.defineProperty(window, "innerWidth", {
        value: width,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: height,
        configurable: true,
      });
    };

    const mockRects = (
      containerRect: Partial<DOMRect>,
      tooltipRect: Partial<DOMRect>,
    ) => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const rect = this.classList.contains("tooltip-box")
          ? tooltipRect
          : containerRect;
        return {
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          ...rect,
          toJSON: () => ({}),
        } as DOMRect;
      });
    };

    const showTooltip = async (
      position:
        | "top"
        | "bottom"
        | "left"
        | "right"
        | "bottom-left"
        | "bottom-right"
        | "top-left"
        | "top-right",
    ) => {
      render(
        <Tooltip text="tip" position={position}>
          <button type="button">anchor</button>
        </Tooltip>,
      );
      const container = document.querySelector(
        ".tooltip-container",
      ) as HTMLElement;
      await act(async () => {
        fireEvent.mouseEnter(container);
      });
      let tooltip: HTMLElement | null = null;
      await waitFor(() => {
        tooltip = document.querySelector(".tooltip-box.visible");
        expect(tooltip).not.toBeNull();
        expect((tooltip as unknown as HTMLElement).style.left).not.toBe("");
      });
      return tooltip as unknown as HTMLElement;
    };

    afterEach(() => {
      vi.restoreAllMocks();
      setViewport(originalInnerWidth, originalInnerHeight);
    });

    it("should shift left inward when overflowing the right edge", async () => {
      setViewport(200, 300);
      // position 'right': left = containerRect.right + offset = 180 + 8 = 188,
      // tooltip width 100 → 188 + 100 = 288 > 200 → clamped to 200 - 100 - 4 = 96
      mockRects(
        { left: 160, top: 50, right: 180, bottom: 70, width: 20, height: 20 },
        { width: 100, height: 20 },
      );

      const tooltip = await showTooltip("right");
      expect(tooltip.style.left).toBe("96px");
    });

    it("should shift right inward when overflowing the left edge", async () => {
      setViewport(1024, 768);
      // position 'left': left = 20 - 100 - 8 = -88 → clamped to margin 4
      mockRects(
        { left: 20, top: 50, right: 40, bottom: 70, width: 20, height: 20 },
        { width: 100, height: 20 },
      );

      const tooltip = await showTooltip("left");
      expect(tooltip.style.left).toBe("4px");
    });

    it("should flip below the trigger when overflowing the top edge", async () => {
      setViewport(1024, 768);
      // position 'top': top = 10 - 20 - 8 = -18 → flip to bottom + offset = 38
      mockRects(
        { left: 100, top: 10, right: 120, bottom: 30, width: 20, height: 20 },
        { width: 60, height: 20 },
      );

      const tooltip = await showTooltip("top");
      expect(tooltip.style.top).toBe("38px");
    });

    it("should shift up inward when overflowing the bottom edge", async () => {
      setViewport(1024, 200);
      // position 'bottom-left': top = 190 + 8 = 198, tooltip height 20 → 218 > 200
      // → clamped to 200 - 20 - 4 = 176
      mockRects(
        { left: 100, top: 170, right: 120, bottom: 190, width: 20, height: 20 },
        { width: 60, height: 20 },
      );

      const tooltip = await showTooltip("bottom-left");
      expect(tooltip.style.top).toBe("176px");
    });

    it("should keep the computed position when nothing overflows", async () => {
      setViewport(1024, 768);
      // position 'bottom-left': left = 120 - 60 = 60, top = 40 + 8 = 48 — all inside
      mockRects(
        { left: 100, top: 20, right: 120, bottom: 40, width: 20, height: 20 },
        { width: 60, height: 20 },
      );

      const tooltip = await showTooltip("bottom-left");
      expect(tooltip.style.left).toBe("60px");
      expect(tooltip.style.top).toBe("48px");
    });

    it("does not park a zero-size trigger on the traffic lights", async () => {
      setViewport(1024, 768);
      mockRects(
        { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
        { width: 80, height: 20 },
      );

      const tooltip = await showTooltip("top");
      expect(tooltip.style.left).toBe("-9999px");
      expect(tooltip.style.top).not.toBe("4px");
    });
  });

  it("keeps a card tooltip open when the pointer moves onto the box", async () => {
    render(
      <Tooltip text="" content={<span>清单</span>} position="right" wrap={false}>
        <button type="button">issue</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "issue" });
    fireEvent.mouseEnter(trigger);
    const box = document.querySelector(".tooltip-box") as HTMLElement;
    expect(box).toHaveClass("visible");
    expect(box).toHaveClass("tooltip-box--interactive");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(box);
    expect(box).toHaveClass("visible");
  });

  it("shows the full context-tag name without an ellipsis clamp", async () => {
    const name = "sandbox-data-file_sandbox_4_very_long_name.html";
    render(
      <ContextTag
        name={name}
        path={`/tmp/${name}`}
        onClick={() => {}}
      />,
    );
    fireEvent.mouseEnter(document.querySelector(".context-tag")!);
    const box = await waitFor(() => {
      const el = document.querySelector(".tooltip-box.visible");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(box).toHaveClass("context-tag-tip");
    expect(box).toHaveTextContent(`点击查看 ${name}`);
  });

  it("hides a plain tooltip when its trigger is detached", async () => {
    const { unmount } = render(
      <Tooltip text="点击查看 prototype-status-for-frontend.md">
        <span>chip</span>
      </Tooltip>,
    );
    const container = document.querySelector(
      ".tooltip-container",
    ) as HTMLElement;
    fireEvent.mouseEnter(container);
    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).not.toBeNull();
    });
    unmount();
    expect(document.querySelector(".tooltip-box.visible")).toBeNull();
  });
});
