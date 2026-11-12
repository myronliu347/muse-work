/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";

/**
 * Helper: set contenteditable text, set up selection inside a text node at end,
 * and fire input event.
 *
 * jsdom's Selection API works, but handleSlashCommandSelect/handleFileSelect
 * check `textNode.nodeType === Node.TEXT_NODE` — if selection is on the div
 * itself (nodeType=1), they skip. So we must ensure selection is inside a
 * Text node.
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  const existing = input.textContent || "";
  const fullText = existing + text;
  input.textContent = fullText;

  // Set selection at end of the text node (not on the div)
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

  await fireInput(input, { data: text, inputType: "insertText" });
}

describe("Slash Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters slash commands by name as more text is typed after /", async () => {
    const { vscode } = renderChatApp();
    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/");
    await waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "init", name: "init", description: "Initialize repository" },
        { id: "help", name: "help", description: "Show help" },
        { id: "clear", name: "clear", description: "Clear session" },
      ],
    });

    // "/" 时展示全部命令
    await waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });
    expect(screen.getAllByTestId(/slash-command-/)).toHaveLength(3);

    // 继续输入 "in" → 只保留 name 匹配的命令
    await typeInInput("in");
    await waitFor(() => {
      expect(screen.queryByTestId("slash-command-help")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("slash-command-init")).toBeInTheDocument();
    expect(screen.queryByTestId("slash-command-clear")).not.toBeInTheDocument();

    // 输入不匹配的字符 → 弹窗隐藏
    await typeInInput("zzz");
    await waitFor(() => {
      expect(
        screen.queryByTestId("slash-commands-popup"),
      ).not.toBeInTheDocument();
    });
  });

  it("does not show a slash toolbar button (commands are typed with /)", () => {
    renderChatApp();
    sendCommand("updateCurrentSession", {
      session: {
        id: "sess-1",
        title: "已有对话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(screen.queryByLabelText("快捷指令")).not.toBeInTheDocument();
  });

});
