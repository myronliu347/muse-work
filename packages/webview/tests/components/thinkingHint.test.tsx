/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "../../src/components/MessageList";
import { MuseTheme } from "../../src/ui/theme";
import type { VsCodeApi } from "../../src/types";

const vscode = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
} as unknown as VsCodeApi;

describe("thinking hint", () => {
  it("shows 思考中... with shimmer while streaming", () => {
    render(
      <MuseTheme>
        <MessageList messages={[]} isStreaming vscode={vscode} />
      </MuseTheme>,
    );

    const hint = screen.getByTestId("thinking-hint");
    expect(hint).toHaveTextContent("思考中...");
    expect(hint.className).toContain("text-shimmer");
  });

  it("hides 思考中... when not streaming", () => {
    render(
      <MuseTheme>
        <MessageList messages={[]} isStreaming={false} vscode={vscode} />
      </MuseTheme>,
    );
    expect(screen.queryByTestId("thinking-hint")).toBeNull();
  });
});
