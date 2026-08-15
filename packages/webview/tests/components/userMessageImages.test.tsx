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
});
