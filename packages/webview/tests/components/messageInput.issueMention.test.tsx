/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageInput } from "../../src/components/chat/MessageInput";
import { convertToMarkdown } from "../../src/utils/messageUtils";
import { MuseTheme } from "../../src/ui/theme";
import type { VsCodeApi } from "../../src/types";

const vscode = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
} as unknown as VsCodeApi;

describe("MessageInput issue mention", () => {
  it("serializes an issue chip from its data attributes", () => {
    const host = document.createElement("div");
    const chip = document.createElement("span");
    chip.className = "context-tag-container";
    chip.setAttribute("data-issue-id", "abc123");
    chip.setAttribute("data-name", "登录失败");
    chip.textContent = "ignored";
    host.append(document.createTextNode("接着 "), chip);
    expect(convertToMarkdown(host).markdown).toBe("接着 [@issue:abc123 登录失败]");
  });

  it("inserts the chosen issue when @ is open", async () => {
    const onSendMessage = vi.fn();
    render(
      <MuseTheme>
        <MessageInput
          mentionIssues={[{ id: "abc123", title: "登录失败" }]}
          onSendMessage={onSendMessage}
          isStreaming={false}
          onAbortMessage={() => {}}
          vscode={vscode}
        />
      </MuseTheme>,
    );

    const input = screen.getByTestId("message-input");
    input.focus();
    input.textContent = "@登";
    const textNode = input.firstChild;
    expect(textNode).toBeTruthy();
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode as Text, (textNode?.textContent ?? "").length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(input);

    const row = await screen.findByTestId("suggestion-issue-abc123");
    fireEvent.click(row);
    expect(input.querySelector("[data-issue-id='abc123']")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSendMessage).toHaveBeenCalledWith(
      "[@issue:abc123 登录失败]",
      undefined,
    );
  });
});
