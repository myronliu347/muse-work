import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderChatApp,
  sendCommand,
  fireEvent,
  act,
  waitFor,
} from "./test-utils";
import { expandActivity } from "./activityTestHelpers";
import { MockDataGenerator } from "../fixtures/mockData";
import { EDIT_TOOL_NAME, READ_TOOL_NAME, WRITE_TOOL_NAME } from "@muse-work/agent";

describe("Read tool header click → openFile with line range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send startLine/endLine derived from offset/limit when clicking the Read tool path", async () => {
    const { vscode } = renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessageWithTool(
        "I'll read a slice of the file.",
        READ_TOOL_NAME,
        '{"file_path": "/home/user/project/src/styles/QueuedMessageList.css", "offset": 56, "limit": 10}',
        "File contents read successfully",
      ),
    ];

    sendCommand("updateMessages", { messages });

    expandActivity();
    const pathEl = await waitFor(() => {
      const el = document.querySelector('[data-testid="tool-line"]') as HTMLElement;
      expect(el).toBeInTheDocument();
      return el;
    });

    expect(pathEl).toHaveTextContent("读取 QueuedMessageList.css L56-65");

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(pathEl.querySelector('[data-testid="tool-file-link"]')!);
    });

    const sent = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const openFileMsg = sent.find(
      (m: { command: string }) => m.command === "openFile",
    ) as Record<string, unknown>;
    expect(openFileMsg).toBeDefined();
    // Absolute path is forwarded for the jump.
    expect(openFileMsg.path).toBe(
      "/home/user/project/src/styles/QueuedMessageList.css",
    );
    // offset 56 → startLine 56; limit 10 → endLine 65 (offset + limit - 1).
    expect(openFileMsg.startLine).toBe(56);
    expect(openFileMsg.endLine).toBe(65);
  });

  it("should send startLine without endLine when only offset is provided", async () => {
    const { vscode } = renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessageWithTool(
        "Reading from a line.",
        READ_TOOL_NAME,
        '{"file_path": "/home/user/project/src/foo.ts", "offset": 42}',
        "done",
      ),
    ];

    sendCommand("updateMessages", { messages });

    expandActivity();
    const pathEl = await waitFor(() => {
      const el = document.querySelector('[data-testid="tool-line"]') as HTMLElement;
      expect(el).toBeInTheDocument();
      return el;
    });
    expect(pathEl).toHaveTextContent("读取 foo.ts L42");

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(pathEl.querySelector('[data-testid="tool-file-link"]')!);
    });

    const sent = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const openFileMsg = sent.find(
      (m: { command: string }) => m.command === "openFile",
    ) as Record<string, unknown>;
    expect(openFileMsg).toBeDefined();
    expect(openFileMsg.startLine).toBe(42);
    // No limit → no endLine (undefined is dropped by JSON.stringify).
    expect(openFileMsg.endLine).toBeUndefined();
  });

  it("shows a toast and keeps the panel closed when the file is gone", async () => {
    const vscode = {
      postMessage: vi.fn((message?: {
        command?: string;
        requestId?: string;
      }) => {
        if (message?.command === "probeFileLinks" && message.requestId) {
          queueMicrotask(() => {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  command: "probeFileLinksResult",
                  requestId: message.requestId,
                  openable: [],
                },
              }),
            );
          });
        }
      }),
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
    };
    renderChatApp(vscode);

    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createAssistantMessageWithTool(
          "I'll write the file.",
          WRITE_TOOL_NAME,
          '{"file_path": "/private/tmp/gone.html", "content": "<html></html>"}',
          "File written",
        ),
      ],
    });
    expandActivity();
    const link = await waitFor(() => {
      const el = document.querySelector('[data-testid="tool-file-link"]');
      expect(el).toBeInTheDocument();
      return el!;
    });

    await act(async () => {
      fireEvent.click(link);
    });

    await waitFor(() => {
      expect(screen.getByText(/文件不存在/)).toBeInTheDocument();
    });
    const cmds = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { command?: string },
    );
    expect(cmds.some((m) => m.command === "openFile")).toBe(false);
    const sent = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { command?: string },
    );
    expect(sent.some((m) => m.command === "openFile")).toBe(false);
    expect(document.querySelector('[data-testid="desktop-panel-tab-file"]')).toBeNull();
  });

  it("opens the file when an edit or write row is clicked", async () => {
    const { vscode } = renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_files",
          role: "assistant" as const,
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [
            {
              type: "tool" as const,
              name: EDIT_TOOL_NAME,
              parameters: JSON.stringify({
                file_path: "/work/probe_dom.py",
                old_string: "a",
                new_string: "b",
              }),
              stage: "end" as const,
              success: true,
              id: "edit_1",
            },
            {
              type: "tool" as const,
              name: WRITE_TOOL_NAME,
              parameters: JSON.stringify({
                file_path: "/work/index.html",
                content: "<p>hi</p>",
              }),
              stage: "end" as const,
              success: true,
              id: "write_1",
            },
          ],
        },
      ],
    });

    expandActivity();
    const lines = await waitFor(() => {
      const found = [...document.querySelectorAll('[data-testid="tool-line"]')];
      expect(found).toHaveLength(2);
      return found as HTMLElement[];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(lines[0]);
    });
    expect(
      (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0])
        .some((message: { command: string }) => message.command === "openFile"),
    ).toBe(false);
    expect(document.querySelector(".diff-viewer-container")).toBeInTheDocument();

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(lines[0].querySelector('[data-testid="tool-file-link"]')!);
    });
    const editOpen = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((call) => call[0])
      .find((message: { command: string }) => message.command === "openFile");
    expect(editOpen?.path).toBe("/work/probe_dom.py");
    expect(document.querySelector(".diff-viewer-container")).toBeInTheDocument();

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(lines[1].querySelector('[data-testid="tool-file-link"]')!);
    });
    const writeOpen = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((call) => call[0])
      .find((message: { command: string }) => message.command === "openFile");
    expect(writeOpen?.path).toBe("/work/index.html");
  });
});
