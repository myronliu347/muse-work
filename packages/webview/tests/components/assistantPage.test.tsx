import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MessageInputHandle } from "../../src/components/chat/MessageInput";
import { AssistantPage } from "../../src/components/assistant/AssistantPage";
import {
  classifyAssistantHref,
  collectAssistantFilePaths,
  stripClosedFileLinks,
} from "../../src/components/assistant/assistantLinks";

describe("AssistantPage", () => {
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
    expect(screen.getAllByText("Muse Bot")).toHaveLength(1);
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
    expect(await screen.findByText("Muse Bot")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 消息" }));
    expect(await screen.findByText("工具调用了")).toBeTruthy();
    expect(api.getMessages).toHaveBeenCalledWith("asst");
  });

  it("labels the master's POPO private messages", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "user", message: "私聊过来", app: "popo" },
          { id: "2", at: 2, role: "assistant", message: "私聊回去", app: "popo" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("私聊过来")).toBeTruthy();
    expect(screen.getByText("私聊回去")).toBeTruthy();
    expect(screen.getAllByText("POPO")).toHaveLength(2);
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
        title: "Muse Bot",
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
      fireEvent.click(screen.getByRole("button", { name: "AI 消息" }));
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
