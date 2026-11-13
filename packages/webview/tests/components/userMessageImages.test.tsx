/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Message } from "../../src/components/message/Message";
import type { Message as MessageType } from "../../src/types";

vi.mock("../../src/styles/Message.css", () => ({}));

afterEach(() => {
  cleanup();
  document.querySelectorAll(".image-preview-modal").forEach((el) => el.remove());
});

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("user message images", () => {
  it("renders 72px thumbnails inside the user bubble below the text", () => {
    const message: MessageType = {
      id: "u1",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        { type: "image", imageUrls: [TINY, TINY] },
        { type: "text", content: "see these" },
      ],
    };

    render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    const bubble = document.querySelector(".user-text-block");
    const block = screen.getByTestId("user-image-block");
    expect(bubble).toContainElement(block);
    expect(bubble).toContainElement(screen.getByText("see these"));
    expect(block.querySelectorAll("img")).toHaveLength(2);
    expect(block.querySelectorAll(".user-image-thumb")).toHaveLength(2);
    const children = [...(bubble?.children ?? [])];
    expect(children[0]).toHaveClass("message-content");
    expect(children[1]).toHaveClass("user-image-block");
  });

  it("shows 图片已清理 instead of an <img> when the upload is gone", () => {
    const message: MessageType = {
      id: "u-gone",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "image", imageUrls: [], missingImageCount: 1 }],
    };

    render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    const block = screen.getByTestId("user-image-block");
    expect(screen.getByTestId("user-image-missing")).toHaveTextContent("图片已清理");
    // The missing ref must not reach an <img src>, or the renderer requests a
    // file that no longer exists.
    expect(block.querySelectorAll("img")).toHaveLength(0);
  });

  it("keeps the remaining thumbs next to the cleaned placeholder", () => {
    const message: MessageType = {
      id: "u-mixed",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        { type: "image", imageUrls: [TINY], missingImageCount: 1 },
      ],
    };

    render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    const block = screen.getByTestId("user-image-block");
    expect(block.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByTestId("user-image-missing")).toBeInTheDocument();
  });

  it("opens preview when clicking a user image thumbnail", () => {
    const message: MessageType = {
      id: "u2",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "image", imageUrls: [TINY] }],
    };

    render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    fireEvent.click(screen.getByTestId("user-image-block").querySelector("button")!);
    expect(document.querySelector(".image-preview-modal")).toBeTruthy();
    expect(document.querySelector(".image-preview-modal img")).toBeTruthy();
  });

  it("removes the preview modal and its keydown listener when the message unmounts with the preview open", () => {
    // Regression: the modal's document keydown listener was only removed on
    // explicit close — unmounting the message mid-preview leaked the listener
    // (and the whole modal + image data via the closure).
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const message: MessageType = {
      id: "u4",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "image", imageUrls: [TINY] }],
    };

    const { unmount } = render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    fireEvent.click(screen.getByTestId("user-image-block").querySelector("button")!);
    expect(document.querySelector(".image-preview-modal")).toBeTruthy();

    unmount();

    expect(document.querySelector(".image-preview-modal")).toBeNull();
    const keydownAdds = addSpy.mock.calls.filter(
      ([type]) => type === "keydown",
    ).length;
    const keydownRemoves = removeSpy.mock.calls.filter(
      ([type]) => type === "keydown",
    ).length;
    expect(keydownRemoves).toBe(keydownAdds);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("closes the image preview on Escape", () => {
    const message: MessageType = {
      id: "u3",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "image", imageUrls: [TINY] }],
    };

    render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    fireEvent.click(screen.getByTestId("user-image-block").querySelector("button")!);
    expect(document.querySelector(".image-preview-modal")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".image-preview-modal")).toBeNull();
  });

  it("steps through every image in the same message", () => {
    const second = "data:image/png;base64,two";
    const message: MessageType = {
      id: "u5",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "image", imageUrls: [TINY, second] }],
    };

    render(
      <Message
        message={message}
        vscode={{ postMessage: () => {}, getState: () => null, setState: () => {} }}
      />,
    );

    const buttons = screen.getByTestId("user-image-block").querySelectorAll("button");
    fireEvent.click(buttons[0]);
    const img = () => document.querySelector(".image-preview-modal img");
    expect(img()?.getAttribute("src")).toBe(TINY);
    expect(document.querySelector(".image-preview-count")?.textContent).toBe("1 / 2");

    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(img()?.getAttribute("src")).toBe(second);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(img()?.getAttribute("src")).toBe(TINY);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(img()?.getAttribute("src")).toBe(second);
  });
});
