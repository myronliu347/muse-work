/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MessageInput } from "../../src/components/chat/MessageInput";
import type { VsCodeApi } from "../../src/types";

vi.mock("../../src/styles/MessageInput.css", () => ({}));
vi.mock("../../src/styles/AttachedImages.css", () => ({}));

function stubVscode(): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: () => null,
    setState: () => {},
  };
}

describe("MessageInput local file pick", () => {
  afterEach(() => cleanup());

  it("shows add-file button only when enableLocalFilePick", () => {
    const vscode = stubVscode();
    const { rerender } = render(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
        enableLocalFilePick
      />,
    );
    expect(screen.getByTestId("add-local-file-btn")).toBeTruthy();
    rerender(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
      />,
    );
    expect(screen.queryByTestId("add-local-file-btn")).toBeNull();
  });

  it("click posts desktopSelectFiles; result inserts @file tags", async () => {
    const vscode = stubVscode();
    render(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
        enableLocalFilePick
        workdir="/proj"
      />,
    );
    fireEvent.click(screen.getByTestId("add-local-file-btn"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectFiles",
    });

    const input = screen.getByTestId("message-input");
    input.focus();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "desktopSelectFilesResult",
            paths: ["/proj/src/a.ts", "/tmp/out.md"],
          },
        }),
      );
    });
    expect(
      input.querySelector('[data-path="src/a.ts"]'),
    ).toBeTruthy();
    expect(
      input.querySelector('[data-path="/tmp/out.md"]'),
    ).toBeTruthy();
  });
});
