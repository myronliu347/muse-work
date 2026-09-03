import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderChatApp, sendCommand } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import {
  READ_TOOL_NAME,
  BASH_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "wave-agent-sdk";

const hoverToolError = () => {
  fireEvent.mouseEnter(document.querySelector(".tool-error")!);
};

describe("Tool Block Error Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should keep the error in a hover tooltip on the tool header", () => {
    renderChatApp();

    const messageWithToolError =
      MockDataGenerator.createAssistantMessageWithToolError(
        "I'll try to read the file for you.",
        READ_TOOL_NAME,
        '{"file_path": "/nonexistent/file.txt"}',
        "File not found: /nonexistent/file.txt",
      );

    sendCommand("updateMessages", { messages: [messageWithToolError] });

    const toolHeader = document.querySelector(".write-tool-header");
    expect(toolHeader).toBeInTheDocument();
    expect(toolHeader).toHaveTextContent(READ_TOOL_NAME);
    expect(document.querySelector(".tool-error")).toBeInTheDocument();
    expect(document.querySelector(".tool-error .tooltip-box")).not.toHaveClass(
      "visible",
    );

    hoverToolError();
    expect(document.querySelector(".tool-error .tooltip-box")).toHaveClass(
      "visible",
    );
    expect(
      document.querySelector('[data-testid="tool-error-detail"]'),
    ).toHaveTextContent("File not found: /nonexistent/file.txt");
  });

  it("should render tool error for Bash tool with command output", () => {
    renderChatApp();

    const bashToolError = MockDataGenerator.createAssistantMessageWithToolError(
      "I'll run that command for you.",
      BASH_TOOL_NAME,
      '{"command": "invalid-command"}',
      "bash: invalid-command: command not found",
    );

    sendCommand("updateMessages", { messages: [bashToolError] });

    const toolBlock = document.querySelector(".tool-block");
    expect(toolBlock).toHaveTextContent(`● ${BASH_TOOL_NAME}`);
    expect(document.querySelector(".tool-error")).toBeInTheDocument();
    expect(document.querySelector(".tool-error .tooltip-box")).not.toHaveClass(
      "visible",
    );

    hoverToolError();
    expect(
      document.querySelector('[data-testid="tool-error-detail"]'),
    ).toHaveTextContent("bash: invalid-command: command not found");
  });

  it("should render tool error for file editing tools", () => {
    renderChatApp();

    const writeToolError =
      MockDataGenerator.createAssistantMessageWithToolError(
        "I'll create that file for you.",
        WRITE_TOOL_NAME,
        '{"file_path": "/readonly/file.txt", "content": "test"}',
        "Permission denied: /readonly/file.txt is not writable",
      );

    sendCommand("updateMessages", { messages: [writeToolError] });

    const toolBlock = document.querySelector(".tool-block");
    expect(toolBlock).toHaveTextContent(`● ${WRITE_TOOL_NAME}`);
    expect(document.querySelector(".tool-error")).toBeInTheDocument();
    hoverToolError();
    expect(
      document.querySelector('[data-testid="tool-error-detail"]'),
    ).toHaveTextContent("Permission denied");

    const diffViewer = document.querySelector(".diff-viewer-container");
    expect(diffViewer).not.toBeInTheDocument();
  });

  it("should render tool without error normally", () => {
    renderChatApp();

    const normalTool = MockDataGenerator.createAssistantMessageWithTool(
      "I'll read the file for you.",
      READ_TOOL_NAME,
      '{"file_path": "/project/package.json"}',
      '{"name": "test-project", "version": "1.0.0"}',
    );

    sendCommand("updateMessages", { messages: [normalTool] });

    const toolHeader = document.querySelector(".write-tool-header");
    expect(toolHeader).toBeInTheDocument();
    expect(document.querySelector(".tool-error")).not.toBeInTheDocument();
  });
});
