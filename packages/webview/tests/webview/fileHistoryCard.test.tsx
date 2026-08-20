import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderChatApp,
  screen,
  sendCommand,
  withinMessages,
  openPanelShortcut,
} from "./test-utils";

function fileHistoryMessage(
  id: string,
  snapshots: Array<Record<string, unknown>>,
  opts: { role?: string } = {},
) {
  return {
    id,
    role: opts.role ?? "assistant",
    timestamp: "2024-01-01T00:00:00.000Z",
    blocks: [
      { type: "text", content: "完成" },
      { type: "file_history", snapshots },
    ],
  };
}

describe("FileHistoryCard in MessageList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the card for the last assistant message with file_history", () => {
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a1", [
          {
            filePath: "/mock/workdir/app.js",
            operation: "modify",
            additions: 3,
            deletions: 1,
          },
          {
            filePath: "/mock/workdir/index.html",
            operation: "modify",
            additions: 2,
            deletions: 0,
          },
        ]),
      ],
    });

    const card = screen.getByTestId("file-history-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("2 个文件已更改");
    expect(card).toHaveTextContent("+5");
    expect(card).toHaveTextContent("−1");
    expect(card).toHaveTextContent("app.js");
    expect(card).toHaveTextContent("index.html");
  });

  it("does not render when the last message has no file_history block", () => {
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "a1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "无改动" }],
        },
      ],
    });

    expect(screen.queryByTestId("file-history-card")).not.toBeInTheDocument();
  });

  it("does not render when all snapshots fall outside the workdir", () => {
    // 0 文件修改：file_history block 存在但快照路径不在当前 workdir 下
    // （如内部 bookkeeping 文件），不能渲染空卡片。
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "查一下" }],
        },
        {
          id: "a1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:01.000Z",
          blocks: [
            { type: "text", content: "无文件改动" },
            {
              type: "file_history",
              snapshots: [
                {
                  filePath: "/tmp/other/out.log",
                  operation: "modify",
                  additions: 3,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(screen.queryByTestId("file-history-card")).not.toBeInTheDocument();
  });

  it("renders the newest message with file_history even when the last message has none", () => {
    // A trailing tool-only message (Bash etc.) carries no file_history block,
    // but since it belongs to the same turn, the turn's changes still show.
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a-old", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 3, deletions: 1 },
        ]),
        {
          id: "a-last",
          role: "assistant",
          timestamp: "2024-01-01T00:00:01.000Z",
          blocks: [{ type: "text", content: "跑测试" }],
        },
      ],
    });

    const card = screen.getByTestId("file-history-card");
    expect(card).toHaveTextContent("1 个文件已更改");
    expect(card).toHaveTextContent("app.js");
  });

  it("does not show earlier turns' changes when the newest turn is a plain question", () => {
    // The newest turn (a question, no file changes) must not fall back to
    // showing the previous turn's file_history card.
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "改文件" }],
        },
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 3 },
        ]),
        {
          id: "u2",
          role: "user",
          timestamp: "2024-01-01T00:00:02.000Z",
          blocks: [{ type: "text", content: "这个函数是干嘛的？" }],
        },
        {
          id: "a2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:03.000Z",
          blocks: [{ type: "text", content: "解释一下" }],
        },
      ],
    });

    expect(screen.queryByTestId("file-history-card")).not.toBeInTheDocument();
  });

  it("merges snapshots across all messages of the newest turn", () => {
    // One turn (user message → assistant response) can span several assistant
    // messages, each carrying its own file_history block; the card merges them.
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "做 xxxx" }],
        },
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 3, deletions: 1 },
        ]),
        fileHistoryMessage("a2", [
          { filePath: "/mock/workdir/lib.ts", operation: "modify", additions: 5 },
        ]),
      ],
    });

    const card = screen.getByTestId("file-history-card");
    expect(card).toHaveTextContent("2 个文件已更改");
    expect(card).toHaveTextContent("app.js");
    expect(card).toHaveTextContent("lib.ts");
    expect(card).toHaveTextContent("+8");
  });

  it("dedupes the same file edited repeatedly within the turn", () => {
    // The SDK records one snapshot per edit; a turn that edits the same file
    // several times must still show a single row. The OLDEST snapshot wins —
    // its diff (pre-first-edit vs current) covers the whole turn.
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "改文件" }],
        },
        fileHistoryMessage("a1", [
          {
            filePath: "/mock/workdir/app.js",
            operation: "modify",
            additions: 9,
            deletions: 2,
            timestamp: 1,
          },
        ]),
        fileHistoryMessage("a2", [
          {
            filePath: "/mock/workdir/app.js",
            operation: "modify",
            additions: 2,
            deletions: 0,
            timestamp: 2,
          },
        ]),
      ],
    });

    const card = screen.getByTestId("file-history-card");
    expect(card).toHaveTextContent("1 个文件已更改");
    // The oldest snapshot's full-turn stats show (+9 −2, not the last +2).
    expect(card).toHaveTextContent("+9");
    expect(card).toHaveTextContent("−2");
    expect(card).not.toHaveTextContent("+2");
    expect(screen.getAllByTestId("file-history-card-row")).toHaveLength(1);
  });

  it("shows only the file name, adding one parent directory on collision", () => {
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "改文件" }],
        },
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/src/components/App.tsx", operation: "modify", additions: 1 },
          { filePath: "/mock/workdir/src/utils/App.tsx", operation: "modify", additions: 2 },
        ]),
      ],
    });

    const card = screen.getByTestId("file-history-card");
    expect(card).toHaveTextContent("components/App.tsx");
    expect(card).toHaveTextContent("utils/App.tsx");
  });

  it("does not render while streaming", () => {
    renderChatApp();
    sendCommand("startStreaming");
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 1 },
        ]),
      ],
    });
    expect(screen.queryByTestId("file-history-card")).not.toBeInTheDocument();

    sendCommand("endStreaming");
    expect(screen.getByTestId("file-history-card")).toBeInTheDocument();
  });

  it("renders the revert button and calls the server revert endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, revertedCount: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { user } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 1 },
        ]),
      ],
    });

    const revertBtn = screen.getByTestId("file-history-card-revert");
    expect(revertBtn).toBeInTheDocument();
    await user.click(revertBtn);

    const called = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/revert-file-history"),
    );
    expect(called).toBeDefined();
    const [, init] = called as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ messageIds: ["a1"] });
    // Restore only the fetch stub; unstubAllGlobals would also remove the
    // ResizeObserver stub installed by tests/setup.ts.
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("row click opens the file in the diff pane", async () => {
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 1 },
        ]),
      ],
    });

    const row = screen.getByTestId("file-history-card-row");
    await row.click();
    // Diff pane opens with the 最近一次修改 (recent) mode targeting app.js.
    const diffPane = await screen.findByTestId("diff-pane");
    expect(diffPane).toBeInTheDocument();
    expect(withinMessages()).toBeTruthy();
  });

  it("diff pane defaults to recent mode showing the last message's files after a session switch", async () => {
    // Opening the diff pane directly (dock toggle) must surface the last
    // assistant message's file changes in 最近一次修改 mode — the data is
    // derived from the live transcript, so it survives session switches.
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a1", [
          { filePath: "/mock/workdir/app.js", operation: "modify", additions: 3, deletions: 1 },
        ]),
      ],
    });

    // Simulate a session switch: reload messages for a new workdir.
    sendCommand("updateMessages", {
      messages: [
        fileHistoryMessage("a2", [
          { filePath: "/mock/workdir2/lib.ts", operation: "modify", additions: 5 },
        ]),
      ],
    });

    // Open the diff panel directly (no card row click).
    openPanelShortcut("diff");
    const select = await screen.findByTestId("diff-mode-select");
    expect(select).toHaveValue("recent");
    expect(screen.getByTestId("diff-pane")).toHaveTextContent("lib.ts");
  });

  it("renders the card right after a turn ends via updateFileHistory (no session switch)", () => {
    // Delta events never carry file_history; the server pushes a lightweight
    // file_history:update when loading drops. The card must appear immediately
    // without re-fetching messages.
    renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        { id: "u1", role: "user", timestamp: "2024-01-01T00:00:00.000Z", blocks: [{ type: "text", content: "改" }] },
        {
          id: "a1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:01.000Z",
          blocks: [{ type: "text", content: "完成" }],
        },
      ],
    });
    expect(screen.queryByTestId("file-history-card")).not.toBeInTheDocument();

    // Streaming stops; the server pushes the turn's file_history delta.
    sendCommand("updateFileHistory", {
      messages: [
        {
          messageId: "a1",
          snapshots: [
            { filePath: "/mock/workdir/app.js", operation: "modify", additions: 3, deletions: 1 },
          ],
        },
      ],
    });

    const card = screen.getByTestId("file-history-card");
    expect(card).toHaveTextContent("1 个文件已更改");
    expect(card).toHaveTextContent("app.js");
    expect(card).toHaveTextContent("+3");
    expect(card).toHaveTextContent("−1");
  });
});
