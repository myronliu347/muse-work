import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";
import { describe, it, expect, beforeEach, vi } from "vitest";

async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();
  const existing = input.textContent || "";
  const fullText = existing + text;
  input.textContent = fullText;

  const range = document.createRange();
  if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
    const textNode = input.firstChild;
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(input);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  await fireInput(input, { inputType: "insertText" });
}

async function waitForFileSuggestionRequest(
  vscode: ReturnType<typeof renderChatApp>["vscode"],
): Promise<string> {
  await waitFor(
    () => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "requestFileSuggestions" }),
      );
    },
    { timeout: 3000 },
  );

  const calls = vscode.postMessage.mock.calls.map((c) => c[0]);
  const requestCall = calls
    .filter((c) => c.command === "requestFileSuggestions")
    .pop();
  return requestCall.requestId;
}

describe("File Upload Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not show any upload option when typing @ without filter text", async () => {
    const { vscode } = renderChatApp();

    await typeInInput("@");

    const reqId1 = await waitForFileSuggestionRequest(vscode);

    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          {
            path: "/workspace/src/test.tsx",
            relativePath: "src/test.tsx",
            name: "test.tsx",
            extension: "tsx",
            icon: "codicon-file",
            isDirectory: false,
          },
        ],
        filterText: "",
        requestId: reqId1,
      });
    });

    await waitFor(() => {
      const items = document.querySelectorAll(".suggestion-item");
      expect(items.length).toBe(1);
    });

    const suggestionItems = document.querySelectorAll(".suggestion-item");
    expect(suggestionItems.length).toBe(1);
    expect(
      document.querySelector(".suggestion-item.upload-option"),
    ).toBeNull();
    expect(suggestionItems[0]).toHaveTextContent(/test.tsx/);
  });

  it("should not show upload option when typing @ with filter text", async () => {
    const { vscode } = renderChatApp();

    await typeInInput("@test");

    const reqId = await waitForFileSuggestionRequest(vscode);

    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          {
            path: "/workspace/src/test.tsx",
            relativePath: "src/test.tsx",
            name: "test.tsx",
            extension: "tsx",
            icon: "codicon-file",
            isDirectory: false,
          },
        ],
        filterText: "test",
        requestId: reqId,
      });
    });

    await waitFor(() => {
      const items = document.querySelectorAll(".suggestion-item");
      expect(items.length).toBe(1);
    });

    const suggestionItems = document.querySelectorAll(".suggestion-item");
    expect(suggestionItems.length).toBe(1);
    expect(
      document.querySelector(".suggestion-item.upload-option"),
    ).toBeNull();
    expect(suggestionItems[0]).toHaveTextContent(/test.tsx/);
  });

  it("should insert file paths into input after desktopSelectFilesResult", async () => {
    renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    act(() => {
      sendCommand("desktopSelectFilesResult", {
        paths: [
          "/tmp/muse-artifacts/document.pdf",
          "/tmp/muse-artifacts/image.png",
        ],
      });
    });

    await waitFor(() => {
      const tags = document.querySelectorAll(
        '[data-testid="message-input"] .context-tag-container',
      );
      expect(tags.length).toBe(2);
    });

    const inputValue = input.textContent
      ?.replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    expect(inputValue).toContain("document.pdf");
    expect(inputValue).toContain("image.png");
  });

  it("should handle single file upload path insertion", async () => {
    renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    act(() => {
      sendCommand("desktopSelectFilesResult", {
        paths: ["/tmp/muse-artifacts/single-file.txt"],
      });
    });

    await waitFor(() => {
      const tags = document.querySelectorAll(
        '[data-testid="message-input"] .context-tag-container',
      );
      expect(tags.length).toBe(1);
    });

    expect(input.textContent).toContain("single-file.txt");
  });

  it("should insert file path after existing input text", async () => {
    renderChatApp();

    await typeInInput("hello ");

    const input = screen.getByTestId("message-input");

    act(() => {
      sendCommand("desktopSelectFilesResult", {
        paths: ["/tmp/muse-artifacts/test.pdf"],
      });
    });

    await waitFor(() => {
      const tags = document.querySelectorAll(
        '[data-testid="message-input"] .context-tag-container',
      );
      expect(tags.length).toBe(1);
    });

    const inputValue = input.textContent
      ?.replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    expect(inputValue).toContain("test.pdf");
    expect(inputValue).toContain("hello");
  });
});
