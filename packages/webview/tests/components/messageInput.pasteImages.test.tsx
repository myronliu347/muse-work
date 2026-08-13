/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { MessageInput } from "../../src/components/MessageInput";
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

function createImagePasteEvent(filename: string): ClipboardEvent {
  const byteCharacters = atob(TINY_PNG_BASE64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: "image/png" });
  const file = new File([blob], filename, { type: "image/png" });
  const dataTransfer = new MockDataTransfer();
  dataTransfer.items.add(file);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: dataTransfer,
    configurable: true,
  });
  return event as ClipboardEvent;
}

function stubVscode(): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: () => null,
    setState: () => {},
  };
}

afterEach(() => {
  cleanup();
});

describe("MessageInput pasted images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows thumbnail strip, allows remove, and sends base64 images", async () => {
    const onSendMessage = vi.fn();
    const vscode = stubVscode();
    render(
      <MessageInput
        onSendMessage={onSendMessage}
        isStreaming={false}
        onAbortMessage={() => {}}
        vscode={vscode}
      />,
    );

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("a.png"));
    });
    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("b.png"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("attached-images").querySelectorAll(".image-thumb"),
      ).toHaveLength(2);
    });

    await act(async () => {
      messageInput.textContent = "look";
      messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalled();
    });
    const [, images] = onSendMessage.mock.calls[0]!;
    expect(images).toHaveLength(2);
    expect(images[0].data).toMatch(/^data:image\/png;base64,/);
    expect(images[0].mediaType).toBe("image/png");
  });

  it("removes image on delete button click", async () => {
    render(
      <MessageInput
        onSendMessage={() => {}}
        isStreaming={false}
        onAbortMessage={() => {}}
        vscode={stubVscode()}
      />,
    );

    const messageInput = screen.getByTestId("message-input");
    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("solo.png"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("attached-images")).toBeTruthy();
    });

    const removeBtn = screen
      .getByTestId("attached-images")
      .querySelector(".remove-image-btn") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("attached-images")).toBeNull();
    });
  });
});
