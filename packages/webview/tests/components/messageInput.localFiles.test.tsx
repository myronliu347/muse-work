/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MessageInput } from "../../src/components/chat/MessageInput";
import type { VsCodeApi } from "../../src/types";

vi.mock("../../src/styles/MessageInput.css", () => ({}));
vi.mock("../../src/styles/AttachedImages.css", () => ({}));

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

interface MockDataTransferItem {
  type: string;
  getAsFile: () => File;
}
class MockDataTransfer {
  private _files: File[] = [];
  private _items: MockDataTransferItem[] = [];
  get files(): File[] {
    return this._files;
  }
  get items(): MockDataTransferItem[] & {
    add: (file: File) => void;
    length: number;
  } {
    const arr = this._items as MockDataTransferItem[] & {
      add: (file: File) => void;
      length: number;
    };
    arr.add = (file: File) => {
      this._files.push(file);
      this._items.push({ type: file.type, getAsFile: () => file });
    };
    return arr;
  }
  get types(): string[] {
    return [];
  }
  getData() {
    return "";
  }
  setData() {}
  clearData() {}
}
(globalThis as Record<string, unknown>).DataTransfer = MockDataTransfer;

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
    expect(input.querySelector('[data-path="src/a.ts"]')).toBeTruthy();
    expect(input.querySelector('[data-path="/tmp/out.md"]')).toBeTruthy();
  });

  it("pastes non-image local file as @file via museGetPathForFile", async () => {
    const vscode = stubVscode();
    const prev = window.museGetPathForFile;
    window.museGetPathForFile = (file: File) =>
      file.name === "note.md" ? "/proj/note.md" : `/tmp/${file.name}`;
    try {
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
      const input = screen.getByTestId("message-input");
      input.focus();

      const md = new File(["x"], "note.md", { type: "text/markdown" });
      const pngBytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) =>
        c.charCodeAt(0),
      );
      const png = new File([pngBytes], "shot.png", { type: "image/png" });

      const clipboardData = {
        items: [
          { type: "text/markdown", getAsFile: () => md },
          { type: "image/png", getAsFile: () => png },
        ],
        files: [md, png],
        types: ["Files"],
        getData: () => "",
      };

      await act(async () => {
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: clipboardData });
        input.dispatchEvent(event);
      });

      expect(input.querySelector('[data-path="note.md"]')).toBeTruthy();
      await waitFor(() => {
        expect(screen.getByTestId("attached-images")).toBeTruthy();
      });
    } finally {
      window.museGetPathForFile = prev;
    }
  });
});
