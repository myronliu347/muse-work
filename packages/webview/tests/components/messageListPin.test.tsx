/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MessageList } from "../../src/components/chat/MessageList";
import { MuseTheme } from "../../src/ui/theme";
import type { VsCodeApi } from "../../src/types";

const vscode = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
} as unknown as VsCodeApi;

describe("MessageList session pin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call flushSync from the layout effect when the transcript mounts", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    await act(async () => {
      render(
        <MuseTheme>
          <MessageList
            messages={[
              {
                id: "u1",
                role: "user",
                timestamp: "2024-01-01T00:00:00.000Z",
                blocks: [{ type: "text", content: "hello" }],
              },
            ]}
            vscode={vscode}
          />
        </MuseTheme>,
      );
      await Promise.resolve();
    });

    expect(errors.filter((line) => line.includes("flushSync"))).toEqual([]);
  });

  it("does not exceed update depth when the scrollport resize observer fires repeatedly", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    type RoCallback = ResizeObserverCallback;
    const observers: Array<{ cb: RoCallback; el: Element }> = [];
    class FakeResizeObserver {
      private cb: RoCallback;
      constructor(cb: RoCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        observers.push({ cb: this.cb, el });
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    await act(async () => {
      render(
        <MuseTheme>
          <MessageList
            messages={[
              {
                id: "u1",
                role: "user",
                timestamp: "2024-01-01T00:00:00.000Z",
                blocks: [{ type: "text", content: "hello" }],
              },
              {
                id: "a1",
                role: "assistant",
                timestamp: "2024-01-01T00:00:01.000Z",
                blocks: [{ type: "text", content: "world" }],
              },
            ]}
            vscode={vscode}
          />
        </MuseTheme>,
      );
      await Promise.resolve();
    });

    const entry = {
      contentRect: { width: 400, height: 600 },
      borderBoxSize: [{ blockSize: 600, inlineSize: 400 }],
      contentBoxSize: [{ blockSize: 600, inlineSize: 400 }],
      devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 400 }],
      target: document.body,
    } as unknown as ResizeObserverEntry;

    await act(async () => {
      for (let i = 0; i < 60; i++) {
        for (const observer of observers) {
          observer.cb([entry], {} as ResizeObserver);
        }
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(
      errors.filter((line) => line.includes("Maximum update depth exceeded")),
    ).toEqual([]);
  });
});
