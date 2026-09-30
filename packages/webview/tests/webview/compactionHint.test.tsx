import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import {
  renderChatApp,
  screen,
  sendCommand,
  createMockVscode,
  sendHostMessage,
  act,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";
import { MuseTheme } from "../../src/ui/theme";
import { fixtures } from "wave-webview-fixtures";

// The message list (and thus the compaction hint) only renders once the
// conversation has at least one message; an empty conversation shows the
// welcome view instead. paneId tags the message for desktop split-view
// instances, which ignore untagged session-scoped commands.
function addUserMessage(paneId?: string) {
  sendCommand("updateMessages", {
    messages: [
      {
        id: "msg_user_1",
        role: "user",
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "/compact" }],
      },
    ],
    ...(paneId ? { paneId } : {}),
  });
}

describe("Compaction hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the compaction status hint while compacting and hides it on completion", () => {
    renderChatApp();
    addUserMessage();

    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();

    sendCommand("compactionStateChange", { isCompacting: true });

    const hint = screen.getByTestId("compaction-hint");
    expect(hint).toHaveTextContent("正在压缩对话…");
    expect(hint.querySelector(".message-list-status-dot")).toBeTruthy();
    expect(screen.getByTestId("messages-container").className).toContain(
      "compacting",
    );

    sendCommand("compactionStateChange", { isCompacting: false });

    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("messages-container").className).not.toContain(
      "compacting",
    );
  });

  it("hides the hint when switching to another session via updateCurrentSession", () => {
    renderChatApp();
    addUserMessage();
    sendCommand("compactionStateChange", { isCompacting: true });
    expect(screen.getByTestId("compaction-hint")).toBeInTheDocument();

    sendCommand("updateCurrentSession", {
      session: {
        id: "sess-other",
        title: "另一个会话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_other",
          role: "user",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hi" }],
        },
      ],
    });

    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();
  });

  it("does not add a system message to the list when compaction state changes", () => {
    renderChatApp();
    addUserMessage();

    sendCommand("compactionStateChange", { isCompacting: true });
    sendCommand("compactionStateChange", { isCompacting: false });

    const container = screen.getByTestId("messages-container");
    expect(container.querySelectorAll(".message")).toHaveLength(1);
  });

  it("ignores compaction state tagged for a different pane (desktop split-view)", () => {
    const mockVscode = createMockVscode();
    render(
      <MuseTheme>
        <ChatApp
          vscode={mockVscode}
          host={{ type: "desktop" } as never}
          paneId="pane-a"
        />
      </MuseTheme>,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(
      fixtures.setInitialState({
        paneId: "pane-a",
        workdir: "/work/a",
        messages: [
          {
            id: "msg_user_1",
            role: "user",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "/compact" }],
          },
        ],
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a",
          createdAt: new Date(),
          lastActiveAt: new Date(),
          latestTotalTokens: 0,
        },
      }),
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "compactionStateChange",
            isCompacting: true,
            paneId: "pane-b",
          },
        }),
      );
    });
    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "compactionStateChange",
            isCompacting: true,
            paneId: "pane-a",
          },
        }),
      );
    });
    expect(screen.getByTestId("compaction-hint")).toBeInTheDocument();
  });
});
