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
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
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
      onOpenFile={options?.onOpenFile}
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

  it("links a bare file path to the file panel", () => {
    const onOpenFile = vi.fn();
    const { vscode, container } = renderMessage({
      content: "see src/foo.ts now",
      onOpenFile,
    });
    const link = container.querySelector(
      '.message-content-container a[href="src/foo.ts"]',
    )!;

    const notPrevented = fireEvent.click(link);

    expect(onOpenFile).toHaveBeenCalledWith("src/foo.ts", undefined, undefined);
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false); // default navigation prevented
  });

  it("routes a file link with line numbers to the file panel", () => {
    const onOpenFile = vi.fn();
    const { container } = renderMessage({
      content: "bug at src/foo.ts:12:34",
      onOpenFile,
    });
    const link = container.querySelector(
      '.message-content-container a[href="src/foo.ts:12:34"]',
    )!;

    fireEvent.click(link);

    expect(onOpenFile).toHaveBeenCalledWith("src/foo.ts", 12, 34);
  });

  it("keeps inline-code styling when a code-span path is clickable", () => {
    const onOpenFile = vi.fn();
    const { container } = renderMessage({
      content: "open `src/foo.ts` now",
      onOpenFile,
    });
    const link = container.querySelector(
      '.message-content-container a[href="src/foo.ts"]',
    )!;
    expect(link.querySelector("code")?.textContent).toBe("src/foo.ts");

    fireEvent.click(link);

    expect(onOpenFile).toHaveBeenCalledWith("src/foo.ts", undefined, undefined);
  });

  it("decodes percent-encoded CJK file hrefs before opening", () => {
    const onOpenFile = vi.fn();
    const { container } = renderMessage({
      content: "see 认证指引.md now",
      onOpenFile,
    });
    const link = container.querySelector(".message-content-container a")!;
    expect(link.getAttribute("href")).toBe(encodeURIComponent("认证指引.md"));

    fireEvent.click(link);

    expect(onOpenFile).toHaveBeenCalledWith("认证指引.md", undefined, undefined);
  });

  it("keeps http links on the openExternal path", () => {
    const onOpenFile = vi.fn();
    const { vscode, externalLink } = renderMessage({ onOpenFile });

    fireEvent.click(externalLink);

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "https://example.com/docs",
    });
  });
});
