/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "../../src/components/chat/MessageList";
import { MuseTheme } from "../../src/ui/theme";
import type { VsCodeApi } from "../../src/types";

const vscode = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
} as unknown as VsCodeApi;

describe("thinking hint", () => {
  it("shows 正在处理… with status dot and shimmer while streaming", () => {
    render(
      <MuseTheme>
        <MessageList messages={[]} isStreaming vscode={vscode} />
      </MuseTheme>,
    );

    const hint = screen.getByTestId("thinking-hint");
    expect(hint).toHaveTextContent("正在处理…");
    expect(hint.querySelector(".message-list-status-dot")).toBeTruthy();
    expect(hint.querySelector(".message-list-status-label")?.className).toContain(
      "text-shimmer",
    );
  });

  it("hides when assistant already has in-progress reasoning", () => {
    render(
      <MuseTheme>
        <MessageList
          messages={[
            {
              id: "a1",
              role: "assistant",
              timestamp: "2024-01-01T00:00:00.000Z",
              blocks: [{ type: "reasoning", content: "hmm", stage: "start" }],
            },
          ]}
          isStreaming
          vscode={vscode}
        />
      </MuseTheme>,
    );
    expect(screen.queryByTestId("thinking-hint")).toBeNull();
  });

  it("hides 正在处理… when not streaming", () => {
    render(
      <MuseTheme>
        <MessageList messages={[]} isStreaming={false} vscode={vscode} />
      </MuseTheme>,
    );
    expect(screen.queryByTestId("thinking-hint")).toBeNull();
  });
});
