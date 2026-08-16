import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/message/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// in the desktop host, localhost links open the preview pane and all
// other links go to the system browser via openExternal.

const CONTENT =
  "preview [local app](http://localhost:5173/app) then [docs](https://example.com/docs)";

function renderMessage(options?: {
  onOpenPreview?: (url: string) => void;
  content?: string;
}) {
  const vscode = createMockVscode();
  const message = MockDataGenerator.createAssistantMessage(
    options?.content ?? CONTENT,
  );
  const result = render(
    <Message
      message={message}
      vscode={vscode}
      onOpenPreview={options?.onOpenPreview}
    />,
  );
  const links = result.container.querySelectorAll(
    ".message-content-container a",
  );
  return {
    ...result,
    vscode,
    localLink: links[0] as HTMLElement,
    externalLink: links[1] as HTMLElement,
  };
}

describe("Message link routing", () => {
  it("desktop host: localhost link opens the preview pane", () => {
    const onOpenPreview = vi.fn();
    const { vscode, localLink } = renderMessage({ onOpenPreview });

    const notPrevented = fireEvent.click(localLink);

    expect(onOpenPreview).toHaveBeenCalledWith("http://localhost:5173/app");
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false); // default navigation prevented
  });

  it("desktop host: non-localhost link goes to the system browser", () => {
    const onOpenPreview = vi.fn();
    const { vscode, externalLink } = renderMessage({ onOpenPreview });

    fireEvent.click(externalLink);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "https://example.com/docs",
    });
  });

  it("desktop host without onOpenPreview: localhost link falls back to external browser", () => {
    const { vscode, localLink } = renderMessage();

    fireEvent.click(localLink);

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "http://localhost:5173/app",
    });
  });

  it("desktop host: clicking non-link content does nothing", () => {
    const onOpenPreview = vi.fn();
    const { container, vscode } = renderMessage({ onOpenPreview });
    const paragraph = container.querySelector(".message-content-container p")!;

    fireEvent.click(paragraph);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });
});
