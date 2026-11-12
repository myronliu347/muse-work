import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MessageInputHandle } from "../../src/components/chat/MessageInput";
import {
  AssistantPage,
  clearAssistantComposerDraft,
} from "../../src/components/assistant/AssistantPage";
import {
  classifyAssistantHref,
  isHtmlPreviewPath,
  collectAssistantFilePaths,
  splitAssistantFileLines,
  stripClosedFileLinks,
} from "../../src/components/assistant/assistantLinks";

function typeComposer(text: string) {
  const input = screen.getByTestId("message-input");
  Object.defineProperty(input, "innerText", {
    value: text,
    configurable: true,
    writable: true,
  });
  input.textContent = text;
  fireEvent.input(input);
}

describe("AssistantPage", () => {
  afterEach(() => {
    cleanup();
    clearAssistantComposerDraft();
  });

  it("follows the watched agent session over the socket instead of polling", async () => {
    const api = {
      listAssistantMessages: vi
        .fn()
        .mockResolvedValue({ messages: [], hasMore: false }),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "agent-1",
        title: "灵光",
        workdir: "/tmp/proj",
        working: false,
      }),
      getMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m1",
            role: "assistant",
            timestamp: "2026-10-22T00:00:00.000Z",
            blocks: [{ type: "text", content: "起始" }],
          },
        ],
        hasMore: false,
      }),
    };
    const postMessage = vi.fn();
    const vscode = {
      postMessage,
      getState: () => undefined,
      setState: () => undefined,
    };
    const interval = vi.spyOn(window, "setInterval");
    const view = render(
      <AssistantPage api={api} vscode={vscode as never} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "轨迹" }));
    expect(await screen.findByText(/起始/)).toBeTruthy();
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      command: "watchSession",
      sessionId: "agent-1",
      watching: true,
    });
    // Push-only: no transcript poll timer is armed (other widgets may tick).
    expect(
      interval.mock.calls.some(([, delay]) => delay === 1500),
    ).toBe(false);

    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          command: "watchedSessionEvent",
          sessionId: "agent-1",
          event: { type: "message:delta", messageId: "m1", text: "追加" },
        },
      }),
    );
    expect(await screen.findByText(/起始追加/)).toBeTruthy();
    expect(api.getMessages).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(postMessage).toHaveBeenCalledWith({
      command: "watchSession",
      sessionId: "agent-1",
      watching: false,
    });
    interval.mockRestore();
  });

  it("renders jsonl roles and sends a user line", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "user", message: "你好" },
          { id: "2", at: 2, role: "assistant", message: "在" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn().mockResolvedValue({
        line: { id: "3", at: 3, role: "user", message: "继续" },
      }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("你好")).toBeTruthy();
    expect(screen.getByText("你好").closest(".assistant-bubble-user")).toBeTruthy();
    expect(screen.getByText("在").closest(".assistant-bubble-assistant")).toBeTruthy();
    expect(screen.getAllByText("灵光")).toHaveLength(1);
    expect(document.querySelectorAll(".assistant-bubble-time").length).toBe(2);
    const input = screen.getByTestId("message-input");
    input.textContent = "继续";
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(api.sendAssistantMessage).toHaveBeenCalledWith("继续", undefined);
    expect(await screen.findByTestId("thinking-hint")).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:status", working: false },
      }),
    );
    expect(screen.queryByTestId("thinking-hint")).toBeNull();
  });

  it("clears the transcript on /clear and does not send it as a message", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: true,
      }),
      sendAssistantMessage: vi.fn(),
      clearAssistantMessages: vi.fn().mockResolvedValue({ ok: true }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("你好")).toBeTruthy();
    typeComposer("/clear");
    fireEvent.click(screen.getByTestId("send-btn"));
    await waitFor(() => expect(api.clearAssistantMessages).toHaveBeenCalledOnce());
    expect(api.sendAssistantMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("你好")).toBeNull());
  });

  it("ignores /clear while the assistant is working", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      clearAssistantMessages: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("你好")).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:status", working: true },
      }),
    );
    typeComposer("/clear");
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(api.clearAssistantMessages).not.toHaveBeenCalled();
    expect(api.sendAssistantMessage).not.toHaveBeenCalled();
    expect(screen.getByText("你好")).toBeTruthy();
  });

  it("switches the current issue when the quoted title is clicked", async () => {
    const onSelectIssue = vi.fn();
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "2",
            at: 2,
            role: "assistant",
            issueId: "issue-1",
            message: "> 【BugFix】将原型快照补参迁入 dev\n\n已补到最新 dev",
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} onSelectIssue={onSelectIssue} />);
    const title = await screen.findByText("【BugFix】将原型快照补参迁入 dev");
    fireEvent.click(title);
    expect(onSelectIssue).toHaveBeenCalledWith("issue-1");
    fireEvent.click(screen.getByText("已补到最新 dev"));
    expect(onSelectIssue).toHaveBeenCalledTimes(1);
  });

  it("shows the waiting queue", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      listAssistantQueue: vi.fn().mockResolvedValue({
        items: [
          { type: "chat", title: "Muse：现在可以关了", active: true },
          { type: "issue", title: "分析 wave-agent", active: true },
          { type: "chat", title: "Muse：稍后" },
        ],
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("Muse：现在可以关了")).toBeTruthy();
    expect(screen.getByText("分析 wave-agent")).toBeTruthy();
    expect(screen.getAllByText("处理中")).toHaveLength(2);
    expect(screen.getByText("等待")).toBeTruthy();
    expect(screen.getByText("Muse：稍后")).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:queue", items: [] },
      }),
    );
    expect(await screen.findByText("没有等待的事件")).toBeTruthy();
  });

  it("renders assistant messages as markdown", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "assistant", message: "- 读代码\n- 改代码" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    const item = await screen.findByText("读代码");
    expect(item.closest("li")).toBeTruthy();
    expect(screen.getByText("改代码").closest("ul")).toBeTruthy();
  });

  it("switches to the assistant session transcript", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        title: "助理",
        workdir: "/tmp/assistant-chat",
      }),
      getMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m1",
            role: "assistant",
            timestamp: "2026-10-08T00:00:00.000Z",
            blocks: [{ type: "text", content: "工具调用了" }],
          },
        ],
      }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("灵光")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "轨迹" }));
    expect(await screen.findByText("工具调用了")).toBeTruthy();
    expect(api.getMessages).toHaveBeenCalledWith("asst");
  });

  it("shows compaction status in the chat and the transcript", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      listAssistantQueue: vi.fn().mockResolvedValue({
        items: [{ type: "issue", title: "看会话", active: true }],
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        title: "助理",
        workdir: "/tmp/assistant-chat",
        compacting: true,
      }),
      getMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m1",
            role: "user",
            timestamp: "2026-10-08T00:00:00.000Z",
            blocks: [{ type: "text", content: "看一下" }],
          },
        ],
      }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByTestId("compaction-hint")).toBeTruthy();
    expect(screen.getByText("正在压缩对话…")).toBeTruthy();
    expect(screen.getByText("压缩中")).toBeTruthy();
    expect(screen.queryByTestId("thinking-hint")).toBeNull();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:status", working: true, compacting: false },
      }),
    );
    expect(screen.queryByTestId("compaction-hint")).toBeNull();
    expect(screen.getByTestId("thinking-hint")).toBeTruthy();
    expect(screen.getByText("处理中")).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:status", working: true, compacting: true },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "轨迹" }));
    expect(await screen.findByTestId("compaction-hint")).toBeTruthy();
    expect(screen.getByText("正在压缩对话…")).toBeTruthy();
    expect(screen.getAllByText("看一下").length).toBeGreaterThan(0);
  });

  it("loads the previous transcript page when older history remains", async () => {
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            id: "tail",
            role: "assistant",
            timestamp: "2026-10-08T00:00:00.000Z",
            blocks: [{ type: "text", content: "当前这一页" }],
          },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        messages: [
          {
            id: "older",
            role: "user",
            timestamp: "2026-10-08T00:00:00.000Z",
            blocks: [{ type: "text", content: "更早的提问" }],
          },
        ],
        hasMore: false,
      })
      .mockResolvedValue({
        messages: [
          {
            id: "tail",
            role: "assistant",
            timestamp: "2026-10-08T00:00:00.000Z",
            blocks: [{ type: "text", content: "当前这一页" }],
          },
        ],
        hasMore: true,
      });
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        workdir: "/tmp/assistant-chat",
      }),
      getMessages,
    };
    render(<AssistantPage api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "轨迹" }));
    expect(await screen.findByText("当前这一页")).toBeTruthy();
    await waitFor(() => {
      expect(getMessages).toHaveBeenCalledWith("asst", { before: "tail", limit: 40 });
    });
    expect(
      document.querySelector('[data-message-id="older"]'),
    ).toBeTruthy();
  });

  it("labels channel messages with their app", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "user", message: "私聊过来", app: "desk" },
          { id: "2", at: 2, role: "assistant", message: "私聊回去", app: "desk" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("私聊过来")).toBeTruthy();
    expect(screen.getByText("私聊回去")).toBeTruthy();
    expect(screen.getAllByText("desk")).toHaveLength(2);
  });

  it("renders an image tag as a picture", async () => {
    const src = "https://cdn.example.com/file/abc";
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "user",
            message: `[img]${src}[/img]`,
          },
          {
            id: "2",
            at: 2,
            role: "assistant",
            message: `图在这\n[img]${src}[/img]`,
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    const shots = await screen.findAllByRole("button", { name: "图片 1" });
    expect(shots).toHaveLength(2);
    expect(shots[0].querySelector("img")?.getAttribute("src")).toBe(src);
    expect(shots[1].querySelector("img")?.getAttribute("src")).toBe(src);
    expect(screen.queryByText(/\[img\]/)).toBeNull();
    expect(screen.getByText("图在这")).toBeTruthy();
  });

  it("shows a user message as plain text inside a capped scroller", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "user",
            message: "# 标题\n第二行 [文档](https://example.com)",
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    const text = await screen.findByText(/# 标题/);
    expect(text.closest(".assistant-user-body")).toBeTruthy();
    expect(text.closest(".markdown-content")).toBeNull();
    expect(screen.queryByRole("link", { name: "文档" })).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("prepends older lines when the log is scrolled to the top", async () => {
    const api = {
      listAssistantMessages: vi.fn(async (query?: { before?: string }) => {
        if (query?.before === "2") {
          return {
            messages: [{ id: "1", at: 1, role: "user" as const, message: "更早" }],
            hasMore: false,
          };
        }
        return {
          messages: [{ id: "2", at: 2, role: "user" as const, message: "新的" }],
          hasMore: true,
        };
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("新的")).toBeTruthy();
    const log = document.querySelector(".assistant-log") as HTMLDivElement;
    Object.defineProperty(log, "scrollTop", { configurable: true, writable: true, value: 0 });
    fireEvent.scroll(log);
    expect(await screen.findByText("更早")).toBeTruthy();
    expect(screen.getByText("新的")).toBeTruthy();
    expect(api.listAssistantMessages).toHaveBeenCalledWith({ before: "2", limit: 50 });
  });

  it("scrolls the chat log to the bottom when switching back from AI messages", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        title: "灵光",
        workdir: "/tmp/assistant-chat",
      }),
      getMessages: vi.fn().mockResolvedValue({ messages: [] }),
    };
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as Element).classList?.contains("assistant-log") ? 900 : 0;
      },
    });
    try {
      render(<AssistantPage api={api} />);
      expect(await screen.findByText("你好")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "轨迹" }));
      expect(document.querySelector(".assistant-log")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "对话" }));
      const log = document.querySelector(".assistant-log") as HTMLDivElement;
      expect(log.scrollTop).toBe(900);
    } finally {
      if (scrollHeight) Object.defineProperty(Element.prototype, "scrollHeight", scrollHeight);
    }
  });

  it("opens file links in the file panel and urls in the browser", async () => {
    const onOpenFile = vi.fn();
    const onOpenUrl = vi.fn();
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "assistant",
            message:
              "看 [App.tsx](/tmp/proj/App.tsx:8) 和 [文档](https://example.com/docs)",
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(
      <AssistantPage api={api} onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} />,
    );
    fireEvent.click(await screen.findByRole("link", { name: "App.tsx" }));
    expect(onOpenFile).toHaveBeenCalledWith("/tmp/proj/App.tsx", 8, undefined);
    fireEvent.click(screen.getByRole("link", { name: "文档" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("does not link a file until the workdir confirms it exists", async () => {
    const onOpenFile = vi.fn();
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    };
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "assistant",
            message:
              "看 [client.ts](packages/sdk/src/client.ts:12) 和 [文档](https://example.com/docs)",
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        workdir: "/Users/liuyuyang/assistant-chat",
      }),
    };
    render(
      <AssistantPage api={api} vscode={vscode} onOpenFile={onOpenFile} />,
    );
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "probeFileLinks",
          workdir: "/Users/liuyuyang/assistant-chat",
          paths: ["packages/sdk/src/client.ts"],
        }),
      );
    });
    expect(screen.queryByRole("link", { name: "client.ts" })).toBeNull();
    expect(screen.getByText(/client\.ts/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "文档" })).toBeTruthy();
    fireEvent.click(screen.getByText(/看 client\.ts/));
    expect(onOpenFile).not.toHaveBeenCalled();

    const requestId = vscode.postMessage.mock.calls.find(
      (call) => call[0].command === "probeFileLinks",
    )?.[0].requestId;
    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          command: "probeFileLinksResult",
          requestId,
          openable: ["packages/sdk/src/client.ts"],
        },
      }),
    );
    fireEvent.click(await screen.findByRole("link", { name: "client.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith(
      "/Users/liuyuyang/assistant-chat/packages/sdk/src/client.ts",
      12,
      undefined,
    );
  });

  it("shows SendMessage file lines as chips and opens html in the browser", async () => {
    const onOpenFile = vi.fn();
    const onOpenUrl = vi.fn();
    const structure = "/tmp/proj/wave-agent-structure.html";
    const runtime = "/tmp/proj/wave-agent-runtime.ts";
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "assistant",
            message: `这就把两份发上来。\n${structure}\n${runtime}`,
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(
      <AssistantPage api={api} onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} />,
    );
    expect(await screen.findByText("这就把两份发上来。")).toBeTruthy();
    expect(screen.queryByText(structure)).toBeNull();
    expect(screen.queryByText(runtime)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "在内置浏览器中打开 wave-agent-structure.html" }),
    );
    expect(onOpenUrl).toHaveBeenCalledWith(`file://${structure}`);
    fireEvent.click(screen.getByRole("button", { name: "打开 wave-agent-runtime.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith(runtime, undefined, undefined);
  });

  it("opens an absolute html path in the browser before the workdir probe answers", async () => {
    const onOpenFile = vi.fn();
    const onOpenUrl = vi.fn();
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    };
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "assistant",
            message: "见 /tmp/proj/wave-agent-structure.html",
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        workdir: "/Users/liuyuyang/assistant-chat",
      }),
    };
    render(
      <AssistantPage api={api} vscode={vscode} onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} />,
    );
    fireEvent.click(
      await screen.findByRole("link", { name: "/tmp/proj/wave-agent-structure.html" }),
    );
    expect(onOpenUrl).toHaveBeenCalledWith("file:///tmp/proj/wave-agent-structure.html");
    expect(onOpenFile).not.toHaveBeenCalled();

    const requestId = vscode.postMessage.mock.calls.find(
      (call) => call[0].command === "probeFileLinks",
    )?.[0].requestId;
    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          command: "probeFileLinksResult",
          requestId,
          openable: [],
        },
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "/tmp/proj/wave-agent-structure.html" }),
      ).toBeNull();
    });
  });

  it("appends a browser comment into the assistant input", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    const inputRef = createRef<MessageInputHandle>();
    render(<AssistantPage api={api} inputRef={inputRef} />);
    expect(await screen.findByTestId("message-input")).toBeTruthy();
    inputRef.current?.appendText("div.shared\n这条元素的评论");
    expect(screen.getByTestId("message-input").textContent).toContain(
      "这条元素的评论",
    );
  });

  it("opens a preview when a message image is clicked", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "1",
            at: 1,
            role: "user",
            message: "看这个",
            images: [{ data: "data:image/png;base64,abc", mediaType: "image/png" }],
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    const { unmount } = render(<AssistantPage api={api} />);
    const shot = await screen.findByRole("button", { name: "图片 1" });
    expect(shot.closest(".assistant-user-images")).toBeTruthy();
    expect(screen.getByText("看这个").closest(".assistant-user-body")).toBeTruthy();
    fireEvent.click(shot);
    const modal = document.querySelector(".image-preview-modal");
    expect(modal?.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,abc",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".image-preview-modal")).toBeNull();
    unmount();
  });

  it("opens a preview when an assistant image is clicked", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "2",
            at: 2,
            role: "assistant",
            message: "截图在这",
            images: [{ data: "data:image/png;base64,abc", mediaType: "image/png" }],
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    const shot = await screen.findByRole("button", { name: "图片 1" });
    expect(shot.closest(".assistant-bubble-assistant")).toBeTruthy();
    fireEvent.click(shot);
    expect(document.querySelector(".image-preview-modal img")?.getAttribute("src")).toBe(
      "data:image/png;base64,abc",
    );
  });

  it("steps through the images in one assistant message", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "3",
            at: 3,
            role: "user",
            message: "两张",
            images: [
              { data: "data:image/png;base64,one", mediaType: "image/png" },
              { data: "data:image/png;base64,two", mediaType: "image/png" },
            ],
          },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "图片 2" }));
    expect(document.querySelector(".image-preview-modal img")?.getAttribute("src")).toBe(
      "data:image/png;base64,two",
    );
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(document.querySelector(".image-preview-modal img")?.getAttribute("src")).toBe(
      "data:image/png;base64,one",
    );
  });

  it("keeps the composer text when the page is left and opened again", () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      sendAssistantMessage: vi.fn(),
    };
    const first = render(<AssistantPage api={api} />);
    typeComposer("先记着");
    first.unmount();

    render(<AssistantPage api={api} />);
    expect(screen.getByTestId("message-input").textContent).toBe("先记着");
  });

  it("keeps the composer focused after send", () => {
    let release: (value: unknown) => void = () => {};
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      sendAssistantMessage: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    };
    render(<AssistantPage api={api} />);
    const input = screen.getByTestId("message-input");
    typeComposer("接着说");
    const button = screen.getByTestId("send-btn");
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveAttribute("contenteditable", "true");
    release({ line: { id: "1", at: 1, role: "user", message: "接着说" } });
  });

  it("does not bring back text that was already sent", () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      sendAssistantMessage: vi.fn().mockResolvedValue({
        line: { id: "1", at: 1, role: "user", message: "先记着" },
      }),
    };
    const first = render(<AssistantPage api={api} />);
    typeComposer("先记着");
    fireEvent.click(screen.getByTestId("send-btn"));
    first.unmount();

    render(<AssistantPage api={api} />);
    expect(screen.getByTestId("message-input").textContent).toBe("");
  });

  it("keeps the composer text when switching to the transcript and back", () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    typeComposer("先记着");
    fireEvent.click(screen.getByRole("button", { name: "轨迹" }));
    expect(screen.queryByTestId("message-input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByTestId("message-input").textContent).toBe("先记着");
  });
});

describe("classifyAssistantHref", () => {
  it("sends files to the file panel and http links to the browser", () => {
    expect(classifyAssistantHref("/tmp/proj/App.tsx:8")).toEqual({
      kind: "file",
      path: "/tmp/proj/App.tsx",
      startLine: 8,
      endLine: undefined,
    });
    expect(classifyAssistantHref("file:///tmp/proj/App.tsx")).toEqual({
      kind: "file",
      path: "/tmp/proj/App.tsx",
    });
    expect(classifyAssistantHref("https://example.com/docs")).toEqual({
      kind: "browser",
      url: "https://example.com/docs",
    });
    expect(isHtmlPreviewPath("/tmp/proj/page.html")).toBe(true);
    expect(isHtmlPreviewPath("/tmp/proj/page.htm")).toBe(true);
    expect(isHtmlPreviewPath("/tmp/proj/page.xhtml")).toBe(true);
    expect(isHtmlPreviewPath("/tmp/proj/App.tsx")).toBe(false);
    expect(
      splitAssistantFileLines("正文\n/tmp/proj/a.html\n/tmp/proj/b.ts"),
    ).toEqual({
      text: "正文",
      files: ["/tmp/proj/a.html", "/tmp/proj/b.ts"],
    });
  });

  it("collects file paths and drops links the host cannot open", () => {
    expect(collectAssistantFilePaths("见 packages/sdk/src/client.ts:12")).toEqual([
      "packages/sdk/src/client.ts",
    ]);
    const html =
      '<p>看 <a href="packages/sdk/src/client.ts:12">client.ts</a> 和 <a href="https://example.com/docs">文档</a></p>';
    expect(
      stripClosedFileLinks(html, new Set(["packages/sdk/src/client.ts"])),
    ).toBe(
      '<p>看 client.ts 和 <a href="https://example.com/docs">文档</a></p>',
    );
  });
});
