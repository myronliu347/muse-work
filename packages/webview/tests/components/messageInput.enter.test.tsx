/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageInput } from "../../src/components/chat/MessageInput";
import { MuseTheme } from "../../src/ui/theme";
import type { VsCodeApi } from "../../src/types";

const vscode = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
} as unknown as VsCodeApi;

function typeAndEnter(value: string) {
  const input = screen.getByTestId("message-input");
  Object.defineProperty(input, "innerText", {
    configurable: true,
    get: () => value,
  });
  input.textContent = value;
  fireEvent.input(input);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
}

describe("MessageInput Enter", () => {
  it("does not send on Enter while the assistant is responding", () => {
    const onSendMessage = vi.fn();
    render(
      <MuseTheme>
        <MessageInput
          onSendMessage={onSendMessage}
          isStreaming
          onAbortMessage={() => {}}
          vscode={vscode}
          inputContent=""
        />
      </MuseTheme>,
    );

    typeAndEnter("follow up");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("sends on Enter when idle", () => {
    const onSendMessage = vi.fn();
    render(
      <MuseTheme>
        <MessageInput
          onSendMessage={onSendMessage}
          isStreaming={false}
          onAbortMessage={() => {}}
          vscode={vscode}
          inputContent=""
        />
      </MuseTheme>,
    );

    typeAndEnter("hello");
    expect(onSendMessage).toHaveBeenCalledWith("hello", undefined);
  });
});
