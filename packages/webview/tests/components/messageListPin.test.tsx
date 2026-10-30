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
});
