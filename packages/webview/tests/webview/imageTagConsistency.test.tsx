import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

// Minimal valid 1x1 transparent PNG base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_DATAURL = `data:image/png;base64,${TINY_PNG_BASE64}`;

// jsdom does not implement DataTransfer; provide a minimal mock that supports
// both the paste handler's reading pattern (items[i].type, items[i].getAsFile())
// and the component's internal `new DataTransfer()` + items.add(file) + .files usage.
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
// Make DataTransfer available globally so component code can use `new DataTransfer()`
(globalThis as Record<string, unknown>).DataTransfer = MockDataTransfer;

/**
 * Create a ClipboardEvent with an image file, matching the real paste handler expectations.
 */
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

  // jsdom does not implement ClipboardEvent constructor; use a generic Event
  // and attach clipboardData via defineProperty.
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: dataTransfer,
    configurable: true,
  });
  return event as ClipboardEvent;
}

describe("Pasted image attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows thumbnail strip on paste, removes on hover delete, and sends base64", async () => {
    const { vscode } = renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("image1.png"));
    });
    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("image2.png"));
    });

    await waitFor(() => {
      const strip = screen.getByTestId("attached-images");
      expect(strip.querySelectorAll(".image-thumb")).toHaveLength(2);
    });

    // Type a caption so send includes text + images
    await act(async () => {
      messageInput.textContent = "see these";
      messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    vscode.postMessage.mockClear();

    const sendButton = screen.getByTestId("send-btn");
    await act(async () => {
      fireEvent.click(sendButton);
    });

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    const sendMessage = sentMessages.find((m) => m.command === "sendMessage");
    expect(sendMessage).toBeDefined();
    expect(sendMessage.images).toHaveLength(2);
    expect(sendMessage.images[0].data).toMatch(/^data:image\/png;base64,/);
    expect(sendMessage.images[0].mediaType).toBe("image/png");
  });

  it("removes a pasted image from the strip", async () => {
    renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      messageInput.dispatchEvent(createImagePasteEvent("solo.png"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("attached-images").querySelectorAll(".image-thumb")).toHaveLength(
        1,
      );
    });

    const removeBtn = screen
      .getByTestId("attached-images")
      .querySelector(".remove-image-btn") as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("attached-images")).toBeNull();
    });
  });

  it("should open image preview modal when clicking history image tag", async () => {
    renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          {
            id: "msg_1",
            role: "user",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [
              {
                type: "text",
                content: "Check this: [image1]",
              },
              {
                type: "image",
                imageUrls: [TINY_PNG_DATAURL],
              },
            ],
          },
        ],
      });
    });

    // Wait for the history tag to render
    await waitFor(() => {
      const historyTags = document.querySelectorAll(
        ".message.user .context-tag.is-image",
      );
      expect(historyTags).toHaveLength(1);
    });

    const historyTag = document.querySelector(
      ".message.user .context-tag.is-image",
    ) as HTMLElement;

    // Click the tag to open preview
    await act(async () => {
      fireEvent.click(historyTag);
    });

    // Verify modal is visible
    await waitFor(() => {
      const modal = document.querySelector(".image-preview-modal");
      expect(modal).toBeInTheDocument();
    });

    const modal = document.querySelector(".image-preview-modal")!;
    expect(modal.querySelector("img")).toBeInTheDocument();

    // Close modal
    const closeBtn = document.querySelector(
      ".image-preview-close",
    ) as HTMLElement;
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    await waitFor(() => {
      expect(
        document.querySelector(".image-preview-modal"),
      ).not.toBeInTheDocument();
    });
  });
});
